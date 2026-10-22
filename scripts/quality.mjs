import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { outsideRepository } from "../src/server/paths.ts";
import { createAnalysisService } from "../src/server/analysis.ts";
import { sourceLines } from "../src/domain/source.ts";

async function main() {
  const { values } = parseArgs({
    options: { jd: { type: "string" }, out: { type: "string" } },
  });
  if (!values.jd || !values.out)
    throw new Error(
      "用法：npm run quality -- --jd <仓库外绝对文件路径> --out <仓库外绝对目录>",
    );
  const jd = await outsideRepository(values.jd, "file");
  const out = await outsideRepository(values.out, "directory");
  if (
    jd === out ||
    /(?:^|[\\/])(?:\.env(?:\..*)?|auth\.json|.*(?:secret|credential|password|token).*)$/i.test(
      jd,
    )
  )
    throw new Error("输入必须是普通 JD 文本文件");
  if (!(await lstat(jd)).isFile() || (await lstat(jd)).size > 48_000)
    throw new Error("JD 文件应为不超过 48 KB 的普通文本");
  const text = await readFile(jd, "utf8");
  // 输出目录先验证可写，避免真实调用后才发现无法保存。
  await mkdir(out, { recursive: true });
  const run = path.join(out, `quality-${Date.now()}-${crypto.randomUUID()}`);
  await mkdir(run);
  const result = await createAnalysisService().analyze(
    { id: crypto.randomUUID(), text, lines: sourceLines(text) },
    "quality",
  );
  await writeFile(
    path.join(run, "validation.json"),
    JSON.stringify(
      result.response.ok ? { ok: true, checks: "V1–V7 通过" } : result.response,
      null,
      2,
    ),
  );
  await writeFile(
    path.join(run, "usage.json"),
    JSON.stringify(
      {
        receipts: result.receipts,
        totalEstimatedCostCny: result.receipts.reduce(
          (sum, row) => sum + row.estimatedCostCny,
          0,
        ),
        totalElapsedMs: result.receipts.reduce(
          (sum, row) => sum + (row.elapsedMs ?? 0),
          0,
        ),
      },
      null,
      2,
    ),
  );
  if (result.response.ok)
    await writeFile(
      path.join(run, "report.json"),
      JSON.stringify(result.response.content, null, 2),
    );
  console.log(
    result.response.ok
      ? "质量验证完成：报告、检查结果和用量已保存到指定外部目录。"
      : `质量验证未通过：${result.response.reasons.join("；")}`,
  );
  if (!result.response.ok) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "质量验证未执行或未完成。请检查命令参数、外部路径权限及本机配置；不会输出凭据或模型原始错误。",
  );
  process.exitCode = 1;
});
