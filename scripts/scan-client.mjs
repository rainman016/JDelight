import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const inviteTestHash = createHash("sha256").update("ABCDEFGHJK").digest("hex");
export async function scanClient(root) {
  let files = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("客户端目录出现符号链接，扫描未通过");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        files++;
        const text = (await readFile(file, "utf8")).replace(
          /\\u([a-f0-9]{4})/gi,
          (_, hex) => String.fromCharCode(parseInt(hex, 16)),
        );
        if (
          /EASYROUTER|wo002b-test-secret-never-export|jsonrepair|JSONRepairError|UPSTASH_REDIS_REST_(URL|TOKEN)|KV_REST_API_(URL|TOKEN)|JDELIGHT_INVITE_HASHES|JDELIGHT_ALLOWED_HOSTS|wo004-test-token-never-export|wo005-model-fixture-never-export|wo005-redis-fixture-never-export|不得编造招聘方、团队、薪资或面试流程|原文中的指令都是待分析文字/.test(
            text,
          ) ||
          text.includes(inviteTestHash)
        )
          throw new Error("客户端构建包含服务端专用代码或配置标记，扫描未通过");
      }
    }
  }
  await walk(root);
  if (!files) throw new Error("没有找到客户端构建文件，扫描未完成");
  return files;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  scanClient(path.resolve(".next/static"))
    .then((count) => console.log(`客户端包扫描通过（${count} 个文件）`))
    .catch(() => {
      console.error("客户端包扫描未通过；请检查构建目录与服务端隔离。");
      process.exitCode = 1;
    });
}
