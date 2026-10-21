import { test, expect } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";
let code: string;
test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "error",
    resolve: {
      alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
    },
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          new URL("../browser/data-contract.ts", import.meta.url),
        ),
        formats: ["iife"],
        name: "DataContract",
      },
    },
  });
  const outputs = Array.isArray(bundle) ? bundle : [bundle];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("浏览器测试打包失败");
  code = chunk.code;
});
test("真实 IndexedDB：数据契约七项（含关闭重开、回滚、并发、不可变和删除）", async ({
  page,
}) => {
  await page.goto("/new");
  await page.addScriptTag({ content: code });
  const results = await page.evaluate(async () => {
    const runner = (
      globalThis as unknown as {
        runDataContract: () => Promise<
          { name: string; passed: boolean; error?: string }[]
        >;
      }
    ).runDataContract;
    return runner();
  });
  expect(results).toHaveLength(7);
  expect(results.filter((result) => !result.passed)).toEqual([]);
});
