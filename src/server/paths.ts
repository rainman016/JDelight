import "server-only";
import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
export async function outsideRepository(
  target: string,
  kind: "file" | "directory",
) {
  if (!path.isAbsolute(target)) throw new Error("路径必须是仓库之外的绝对路径");
  const absolute = path.resolve(target);
  let existing = absolute;
  const suffix: string[] = [];
  let canonical: string;
  while (true) {
    try {
      canonical = path.join(await realpath(existing), ...suffix.reverse());
      break;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        path.dirname(existing) === existing
      )
        throw new Error("路径无法访问");
      suffix.push(path.basename(existing));
      existing = path.dirname(existing);
    }
  }
  let current = kind === "directory" ? canonical : path.dirname(canonical);
  while (true) {
    try {
      await lstat(path.join(current, ".git"));
      throw new Error("输入、输出和账本路径必须在仓库之外");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return canonical;
}
