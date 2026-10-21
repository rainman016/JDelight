import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
const root = process.cwd();
const rows = [];
for (const name of ["home", "new", "job"]) {
  const urls = JSON.parse(
    fs.readFileSync(`.cache/evidence/scripts-${name}.json`, "utf8"),
  );
  const files = [
    ...new Set(
      urls
        .map((url) => new URL(url).pathname)
        .filter((file) => file.startsWith("/_next/")),
    ),
  ];
  let bytes = 0,
    gzip = 0;
  for (const file of files) {
    const data = fs.readFileSync(
      path.join(root, ".next", file.replace("/_next/", "")),
    );
    bytes += data.length;
    gzip += gzipSync(data).length;
  }
  rows.push({
    route:
      name === "home"
        ? "/（含开场异步脚本）"
        : name === "new"
          ? "/new"
          : "/jobs/[id]",
    scripts: files.length,
    bytes,
    gzip,
  });
}
const dir = ".next/static/chunks";
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const data = fs.readFileSync(path.join(dir, file));
  if (data.includes(Buffer.from("THREE.WebGLRenderer")))
    rows.push({
      route: "开场 3D 懒加载包",
      scripts: 1,
      bytes: data.length,
      gzip: gzipSync(data).length,
    });
}
const result = rows.map((row) => ({
  ...row,
  kib: +(row.bytes / 1024).toFixed(1),
  gzipKib: +(row.gzip / 1024).toFixed(1),
}));
fs.writeFileSync(
  ".cache/evidence/size-report.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.table(result);
