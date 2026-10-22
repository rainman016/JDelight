import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
        const text = await readFile(file, "utf8");
        if (/EASYROUTER|wo002b-test-secret-never-export/.test(text))
          throw new Error("客户端构建包含服务端配置标记或测试密钥，扫描未通过");
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
