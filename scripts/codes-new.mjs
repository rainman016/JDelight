import { randomInt } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { outsideRepository } from "../src/server/paths.ts";
import { inviteHash } from "../src/server/invite.ts";
import { INVITE_ALPHABET } from "../src/domain/invite.ts";
export async function writeInviteCodes({ count = 20, out, pick = randomInt }) {
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw new Error("数量需为 1–1000 的整数");
  const target = await outsideRepository(out, "file");
  const handle = await open(target, "wx", 0o600);
  let completed = false;
  try {
    const codes = new Set();
    for (let tries = 0; codes.size < count && tries < count * 100; tries++) {
      let code = "";
      for (let i = 0; i < 10; i++) {
        const index = pick(INVITE_ALPHABET.length);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= INVITE_ALPHABET.length
        )
          throw new Error("随机源不可用");
        code += INVITE_ALPHABET[index];
      }
      codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
    }
    if (codes.size !== count) throw new Error("随机源未生成足够的不同码");
    await handle.writeFile([...codes].join("\n") + "\n", "utf8");
    await handle.sync();
    completed = true;
    return [...codes].map((code) => inviteHash(code)).join(",");
  } finally {
    await handle.close();
    if (!completed) await unlink(target).catch(() => {});
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const values = { count: 20, out: "" };
  try {
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === "--count") values.count = Number(args[i + 1]);
      else if (args[i] === "--out" && args[i + 1]) values.out = args[i + 1];
      else throw new Error("请使用 --count 20 --out 仓库外绝对路径");
    }
    console.log(await writeInviteCodes(values));
  } catch {
    console.error(
      "邀请码未生成：检查数量、仓库外绝对路径及文件是否已存在；不会覆盖已有文件。",
    );
    process.exitCode = 1;
  }
}
