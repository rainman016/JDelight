import path from "node:path";
import os from "node:os";
import { readFile, mkdir, open, rename, unlink, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { outsideRepository } from "../src/server/paths.ts";

const keys = [
  "EASYROUTER_API_KEY",
  "EASYROUTER_BASE_URL",
  "EASYROUTER_MODEL",
  "JDELIGHT_LEDGER_PATH",
];
export async function setupEnvironment({
  cwd = process.cwd(),
  home = os.homedir(),
  tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompt,
  output = console.log,
  ignored = () => {
    try {
      execFileSync(
        "git",
        ["-C", cwd, "check-ignore", "--quiet", "--", ".env.local"],
        { stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  },
} = {}) {
  if (!tty)
    throw new Error("请在交互终端运行 npm run setup:env，非 TTY 不接收密钥");
  if (!ignored()) throw new Error(".env.local 未被 Git 忽略，拒绝写入");
  const file = path.join(cwd, ".env.local");
  let original = "";
  let exists = false;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("配置入口不是普通文件，拒绝写入");
    original = await readFile(file, "utf8");
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("现有配置无法安全读取，拒绝覆盖");
  }
  if (
    exists &&
    !/^(y|yes|是)$/i.test(
      (await prompt("配置已存在，是否只替换四项变量？[y/N] ", false)).trim(),
    )
  ) {
    output("已取消，现有配置未修改");
    return;
  }
  const apiKey = (
    await prompt("EasyRouter API key（隐藏输入）：", true)
  ).trim();
  const baseUrl =
    (await prompt("Base URL [https://easyrouter.io/v1]：", false)).trim() ||
    "https://easyrouter.io/v1";
  const model =
    (await prompt("Model [deepseek-flash]：", false)).trim() ||
    "deepseek-flash";
  const ledger =
    (
      await prompt(
        `账本绝对路径 [${path.join(home, ".jdelight", "usage-ledger.json")}]：`,
        false,
      )
    ).trim() || path.join(home, ".jdelight", "usage-ledger.json");
  if (
    !apiKey ||
    /[\r\n]/.test(apiKey) ||
    baseUrl !== "https://easyrouter.io/v1" ||
    model !== "deepseek-flash"
  )
    throw new Error("四项配置不合法，未写入");
  if (
    !/\.json$/i.test(path.basename(ledger)) ||
    /auth|secret|credential|password|token|\.env/i.test(path.basename(ledger))
  )
    throw new Error("账本文件名不合法，未写入");
  const ledgerPath = await outsideRepository(ledger, "file");
  // 首次仅以 wx 建空账本；已有文件绝不读取、覆盖或重置。
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  let ledgerHandle;
  try {
    ledgerHandle = await open(ledgerPath, "wx", 0o600);
    await ledgerHandle.writeFile('{"schemaVersion":1,"entries":[]}\n');
  } catch (error) {
    if (error.code !== "EEXIST") throw new Error("账本无法初始化，未写入配置");
  } finally {
    await ledgerHandle?.close();
  }
  const values = [apiKey, baseUrl, model, ledgerPath];
  const seen = new Set();
  const lines = original.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/);
    const index = match ? keys.indexOf(match[1]) : -1;
    if (index === -1) return [line];
    if (seen.has(index)) return [];
    seen.add(index);
    return [
      `${keys[index]}=${JSON.stringify(values[index]).replace(/\$/g, "\\$")}`,
    ];
  });
  for (let index = 0; index < keys.length; index++)
    if (!seen.has(index))
      lines.push(
        `${keys[index]}=${JSON.stringify(values[index]).replace(/\$/g, "\\$")}`,
      );
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(lines.join("\n").replace(/\n*$/, "\n"));
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } catch {
    throw new Error("配置写入失败，未输出任何密钥");
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
  output("已写入 .env.local（密钥未显示）");
  output("下一步：重启本机应用，在校对页打开真实 AI 开关；已有账本不会重置。");
}
async function terminalPrompt(label, hidden) {
  if (!hidden) {
    const line = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return await line.question(label);
    } finally {
      line.close();
    }
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const data = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          finish();
          reject(new Error("已取消"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", data);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  setupEnvironment({ prompt: terminalPrompt }).catch(() => {
    console.error(
      "填写未完成：请使用交互终端，确认文件已被 Git 忽略、路径在仓库外且可写；密钥未显示。",
    );
    process.exitCode = 1;
  });
