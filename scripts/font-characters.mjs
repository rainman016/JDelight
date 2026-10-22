import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
let text = "";
function visitFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visitFiles(file);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.test\./.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isJsxText(node) ||
        [
          ts.SyntaxKind.TemplateHead,
          ts.SyntaxKind.TemplateMiddle,
          ts.SyntaxKind.TemplateTail,
        ].includes(node.kind)
      )
        text += node.text;
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
visitFiles("src");
for (const file of ["sample-jd.json", "sample-report.json"])
  text += fs.readFileSync(path.join("fixtures", file), "utf8");
process.stdout.write(text);
