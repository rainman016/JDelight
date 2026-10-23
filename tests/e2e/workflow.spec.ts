import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Backup } from "../../src/domain/backup";
let code: string;
test.beforeAll(async () => {
  const bundle = await build({
    configFile: false,
    plugins: [react()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "error",
    resolve: {
      alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
    },
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          new URL("../browser/workflow-contract.ts", import.meta.url),
        ),
        formats: ["iife"],
        name: "WorkflowContract",
      },
    },
  });
  const chunk = (Array.isArray(bundle) ? bundle : [bundle])
    .flatMap((result) => ("output" in result ? result.output : []))
    .find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("浏览器契约打包失败");
  code = chunk.code;
  await mkdir(".cache/evidence", { recursive: true });
});
interface Helpers {
  runWorkflowContract: () => Promise<
    { name: string; passed: boolean; error?: string }[]
  >;
  workflowRead: () => Promise<Backup>;
  seedAnchorJob: () => Promise<{
    jobId: string;
    blockId: string;
    text: string;
  }>;
  mountQuestionFailure: (jobId: string) => Promise<void>;
}
async function helpers(page: Page) {
  if (
    await page.evaluate(
      () =>
        typeof (globalThis as unknown as Partial<Helpers>).workflowRead ===
        "function",
    )
  )
    return;
  const errors: string[] = [],
    record = (error: Error) => errors.push(error.message);
  page.on("pageerror", record);
  await page.addScriptTag({ content: code });
  page.off("pageerror", record);
  if (
    !(await page.evaluate(
      () =>
        typeof (globalThis as unknown as Partial<Helpers>).workflowRead ===
        "function",
    ))
  )
    throw new Error(`浏览器辅助脚本未加载：${errors.join("；")}`);
}
async function readData(page: Page) {
  await helpers(page);
  return page.evaluate(() => (globalThis as unknown as Helpers).workflowRead());
}
async function tabTo(page: Page, control: Locator) {
  for (let i = 0; i < 240; i++) {
    if (await control.evaluate((element) => document.activeElement === element))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`键盘没有走到 ${await control.textContent()}`);
}
async function activate(page: Page, control: Locator) {
  await tabTo(page, control);
  await page.keyboard.press("Enter");
}
async function snapshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({ path: `.cache/evidence/wo003-${name}.png` });
}
async function enter(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const control = page.getByRole("button", { name: "开始：进入我的岗位" });
  await expect(page.locator(".intro")).toHaveAttribute("data-done", "true");
  await activate(page, control);
  await expect(
    page.getByRole("heading", { name: "我的岗位", exact: true }),
  ).toBeVisible();
}
async function create(page: Page) {
  await enter(page);
  await activate(
    page,
    page.getByRole("link", { name: "贴一份 JD", exact: true }),
  );
  await activate(
    page,
    page.getByRole("button", { name: "试试示例", exact: true }),
  );
  await page.keyboard.press("Control+Enter");
  await activate(
    page,
    page.getByRole("button", { name: "确认原文，开始分析" }),
  );
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(page.getByRole("button", { name: /报告第 1 版/ })).toBeVisible();
  return page.url().split("/").at(-1)!;
}
async function chooseFile(page: Page, data: unknown) {
  const chooser = page.waitForEvent("filechooser");
  await activate(
    page,
    page.getByRole("button", { name: "选择备份文件", exact: true }),
  );
  await (
    await chooser
  ).setFiles({
    name: "jdelight-test-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  });
}
test("真实 Chromium：补充版本、回滚、并发、导入覆盖与重映射十二项契约", async ({
  page,
}) => {
  await page.goto("/new");
  await helpers(page);
  const results = await page.evaluate(() =>
    (globalThis as unknown as Helpers).runWorkflowContract(),
  );
  expect(results).toHaveLength(12);
  expect(results.filter((item) => !item.passed)).toEqual([]);
});

for (const width of [1440, 390])
  test(`${width}：键盘整条路线、加入修改撤下、旧版导出、合并、新浏览器导入一致`, async ({
    page,
    browser,
    context,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [],
      external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin !== "http://127.0.0.1:3100") {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 900 });
    await create(page);
    await snapshot(page, `${width}-flow-report`);
    await activate(page, page.locator(".jd-first .cite").first());
    if (width >= 900) {
      await expect(page.locator(".jd-thread path")).toHaveCount(1);
      await expect(
        page.locator('.jd-source-line[data-highlighted="true"]'),
      ).toHaveCount(1);
    } else {
      await expect(page.getByRole("dialog", { name: /原文/ })).toBeVisible();
      await expect(page.getByRole("dialog").locator("mark")).not.toBeEmpty();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /原文/ })).toHaveCount(0);
    await expect(page.locator(".jd-thread")).toHaveCount(0);
    await tabTo(page, page.getByRole("tab", { name: "完整报告", exact: true }));
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("heading", { name: "最该准备的重点", exact: true }),
    ).toBeVisible();
    await snapshot(page, `${width}-flow-brief`);
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByRole("tab", { name: "完整报告", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const ask = page.getByRole("button", { name: /问这一节.*岗位定位/ });
    await activate(page, ask);
    const dock = page.getByRole("dialog", { name: "问一问", exact: true });
    await expect(dock).toBeVisible();
    await dock
      .getByRole("textbox", { name: "想问什么" })
      .fill("怎样解释这段岗位定位？");
    await activate(
      page,
      dock.getByRole("button", { name: "获取示例解答", exact: true }),
    );
    await expect(dock).toContainText("示例解答 · 通常");
    await snapshot(page, `${width}-question`);
    await activate(
      page,
      dock.getByRole("button", { name: "加入报告", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: /报告第 2 版/ }),
    ).toBeVisible();
    const note = page.locator(".detail-screen [data-supplement-id]");
    await expect(note).toContainText("怎样解释这段岗位定位？");
    const blockId = await note.evaluate((element) =>
      element.parentElement?.previousElementSibling?.getAttribute(
        "data-block-id",
      ),
    );
    expect(blockId).toBeTruthy();
    await page.reload();
    await expect(note).toContainText("示例解答：");
    expect(
      await note.evaluate((element) =>
        element.parentElement?.previousElementSibling?.getAttribute(
          "data-block-id",
        ),
      ),
    ).toBe(blockId);
    await activate(
      page,
      note.getByRole("button", { name: "修改", exact: true }),
    );
    await note
      .getByRole("textbox", { name: "修改补充", exact: true })
      .fill("修改后的通用解释，旧版本仍然保留原解答。");
    await activate(
      page,
      note.getByRole("button", { name: "保存为新版本", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: /报告第 3 版/ }),
    ).toBeVisible();
    await expect(note).toContainText("修改后的通用解释");
    await snapshot(page, `${width}-supplement`);
    await activate(
      page,
      note.getByRole("button", { name: "撤下", exact: true }),
    );
    await expect(
      page.getByRole("button", { name: /报告第 3 版/ }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /报告第 4 版/ }),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
    const version = page.getByRole("button", { name: /报告第 4 版/ });
    await tabTo(page, version);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".jd-readonly")).toContainText("第 2 版");
    await expect(note).toContainText("示例解答：");
    await expect(note).not.toContainText("修改后的通用解释");
    await expect(page.getByRole("button", { name: /问这一节/ })).toHaveCount(0);
    await expect(note.getByRole("button")).toHaveCount(0);
    await activate(
      page,
      page.getByRole("button", { name: "导出报告", exact: true }),
    );
    await activate(
      page,
      page.getByRole("button", { name: "复制全文", exact: true }),
    );
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("报告第 2 版");
    expect(copied).toContain("怎样解释这段岗位定位？");
    expect(copied).toContain("示例解答：");
    expect(copied).not.toContain("修改后的通用解释");
    await activate(
      page,
      page.getByRole("button", { name: "回到当前第 4 版", exact: true }),
    );
    await tabTo(page, page.getByRole("tab", { name: "完整报告", exact: true }));
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("region", { name: "我问过的", exact: true }),
    ).toContainText("怎样解释这段岗位定位？");
    await snapshot(page, `${width}-asked-brief`);
    await activate(page, page.getByRole("link", { name: "← 我的岗位" }));
    await expect(page.locator(".jd-backup-reminder")).toContainText(
      "还没有备份过",
    );
    await activate(
      page,
      page.getByRole("button", { name: "数据与备份", exact: true }),
    );
    await snapshot(page, `${width}-backup`);
    const downloaded = page.waitForEvent("download");
    await activate(
      page,
      page.getByRole("button", { name: "导出成文件", exact: true }),
    );
    const path = await (await downloaded).path();
    if (!path) throw new Error("没有生成备份文件");
    const serialized = await readFile(path, "utf8"),
      backup = JSON.parse(serialized) as Backup;
    expect(Object.keys(backup).sort()).toEqual(
      [
        "format",
        "formatVersion",
        "schemaVersion",
        "exportedAt",
        "jobs",
        "sourceVersions",
        "reportVersions",
        "supplements",
      ].sort(),
    );
    expect(backup.reportVersions).toHaveLength(4);
    expect(backup.supplements).toHaveLength(1);
    await writeFile(`.cache/evidence/wo003-${width}-backup.json`, serialized);
    await activate(
      page,
      page.getByRole("button", { name: "好的", exact: true }),
    );
    await expect(page.locator(".jd-backup-reminder")).toHaveCount(0);
    await activate(
      page,
      page.getByRole("button", { name: "+ 备注", exact: true }),
    );
    await page
      .getByRole("textbox", { name: "备注", exact: true })
      .fill("导出后的新备注");
    await page.keyboard.press("Enter");
    await expect(page.locator(".jd-backup-reminder")).toContainText(
      "上次备份后有新的改动",
    );
    await activate(
      page,
      page.getByRole("button", { name: "数据与备份", exact: true }),
    );
    await chooseFile(page, backup);
    await expect(page.getByRole("dialog")).toContainText("其中 1 个岗位");
    await snapshot(page, `${width}-import-preview`);
    await tabTo(page, page.getByRole("radio", { name: /合并（推荐）/ }));
    await page.keyboard.press("ArrowDown");
    await activate(
      page,
      page.getByRole("button", { name: "下一步", exact: true }),
    );
    await snapshot(page, `${width}-replace-confirm`);
    expect((await readData(page)).jobs).toHaveLength(1);
    await activate(
      page,
      page.getByRole("button", { name: "返回", exact: true }),
    );
    await tabTo(page, page.getByRole("radio", { name: /用文件替换/ }));
    await page.keyboard.press("ArrowUp");
    await activate(
      page,
      page.getByRole("button", { name: "确认导入", exact: true }),
    );
    await activate(
      page,
      page.getByRole("button", { name: "好的", exact: true }),
    );
    await expect(page.locator("article.job")).toHaveCount(2);
    const merged = await readData(page);
    expect(merged.reportVersions).toHaveLength(8);
    expect(merged.supplements).toHaveLength(2);
    expect(
      merged.jobs.some((job) => job.title.endsWith("（导入的副本）")),
    ).toBe(true);
    const fresh = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
      viewport: { width, height: 900 },
    });
    try {
      const restored = await fresh.newPage();
      await enter(restored);
      await expect(restored.locator("article.job")).toHaveCount(0);
      await activate(
        restored,
        restored.getByRole("button", { name: "数据与备份", exact: true }),
      );
      await chooseFile(restored, backup);
      await activate(
        restored,
        restored.getByRole("button", { name: "确认导入", exact: true }),
      );
      await activate(
        restored,
        restored.getByRole("button", { name: "好的", exact: true }),
      );
      await expect(restored.locator("article.job")).toHaveCount(1);
      const result = await readData(restored);
      for (const key of [
        "jobs",
        "sourceVersions",
        "reportVersions",
        "supplements",
      ] as const)
        expect(result[key]).toEqual(backup[key]);
      await snapshot(restored, `${width}-restored`);
    } finally {
      await fresh.close();
    }
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

test("错误、过新备份只提示原因，不改任何本机记录", async ({ page }) => {
  await create(page);
  await page.getByRole("link", { name: "← 我的岗位" }).click();
  const before = await readData(page);
  for (const bad of [
    "{不完整",
    { ...before, formatVersion: 2 },
    { ...before, schemaVersion: 3 },
    { ...before, jobs: [] },
  ]) {
    await page.getByRole("button", { name: "数据与备份", exact: true }).click();
    await chooseFile(page, bad);
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    const after = await readData(page);
    for (const key of [
      "jobs",
      "sourceVersions",
      "reportVersions",
      "supplements",
    ] as const)
      expect(after[key]).toEqual(before[key]);
    await page.keyboard.press("Escape");
  }
});

for (const kind of ["重复句子", "跨行", "反向"] as const)
  test(`选中提问：${kind}，加入刷新后仍在原文字块`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/new");
    await helpers(page);
    const seeded = await page.evaluate(() =>
      (globalThis as unknown as Helpers).seedAnchorJob(),
    );
    await page.goto(`/jobs/${seeded.jobId}`);
    const block = page.locator(
      `.detail-screen [data-block-id="${seeded.blockId}"]`,
    );
    await block.scrollIntoViewIfNeeded();
    const selected = await block.evaluate((element, mode) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.nextNode();
      while (current && !(current.textContent ?? "").includes("重复句子在这里"))
        current = walker.nextNode();
      if (!current) throw new Error("选区测试缺少文字");
      const text = current.textContent!;
      const start = mode === "重复句子" ? text.indexOf("重复句子在这里", 1) : 0;
      const end = mode === "重复句子" ? start + "重复句子在这里".length : 110;
      const range = document.createRange();
      range.setStart(current, start);
      range.setEnd(current, end);
      const selection = getSelection()!;
      selection.removeAllRanges();
      if (mode === "反向")
        selection.setBaseAndExtent(current, end, current, start);
      else selection.addRange(range);
      const rects = range.getClientRects().length;
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return {
        exact: text.slice(start, end),
        rects,
        reverse: selection.anchorOffset > selection.focusOffset,
      };
    }, kind);
    if (kind === "跨行") expect(selected.rects).toBeGreaterThan(1);
    if (kind === "反向") expect(selected.reverse).toBe(true);
    await page.getByRole("button", { name: "问一问", exact: true }).click();
    const dock = page.getByRole("dialog", { name: "问一问", exact: true });
    await dock.getByRole("textbox", { name: "想问什么" }).fill(`${kind}的疑问`);
    await dock.getByRole("button", { name: "获取示例解答" }).click();
    await dock.getByRole("button", { name: "加入报告", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /报告第 2 版/ }),
    ).toBeVisible();
    await page.reload();
    const note = page.locator(".detail-screen [data-supplement-id]");
    await expect(note).toContainText(`${kind}的疑问`);
    await expect(note).toContainText(selected.exact);
    const data = await readData(page);
    expect(data.supplements[0].anchor.exact).toBe(selected.exact);
    expect(data.supplements[0].anchor.blockId).toBe(seeded.blockId);
  });

for (const mode of ["选区", "整节"] as const)
  test(`正文锚点：${mode}排除类型与出处，刷新重开后可加入原位`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await create(page);
    const initial = await readData(page);
    const paragraph = initial.reportVersions[0].content.sections[0].blocks[0];
    if (paragraph.type !== "paragraph") throw new Error("需要混排正文夹具");
    const expected = paragraph.claims.map((claim) => `${claim.text} `).join("");
    const block = page.locator(
      `.detail-screen [data-block-id="${paragraph.blockId}"]`,
    );
    await block.scrollIntoViewIfNeeded();
    expect(await block.locator(".kind").count()).toBeGreaterThan(0);
    expect(await block.locator(".cite").count()).toBeGreaterThan(0);
    const raw = await block.textContent();
    expect(raw!.length).toBeGreaterThan(expected.length);
    if (mode === "选区") {
      await block.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selected = getSelection()!;
        selected.removeAllRanges();
        selected.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.getByRole("button", { name: "问一问", exact: true }).click();
    } else {
      await page.getByRole("button", { name: /问这一节.*岗位定位/ }).click();
    }
    const dock = page.getByRole("dialog", { name: "问一问", exact: true });
    const excerpt = dock.locator(".jd-dock-selected");
    expect(await excerpt.textContent()).toBe(`你选中的${expected}`);
    await dock
      .getByRole("textbox", { name: "想问什么" })
      .fill(`${mode}只摘录正文`);
    await dock.getByRole("button", { name: "获取示例解答" }).click();
    await expect(dock).toContainText("示例解答 · 通常");
    if (mode === "选区") await snapshot(page, "fix1-question");
    await dock.getByRole("button", { name: "关闭问答卡", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "查看解答", exact: true }).click();
    await expect(dock).toBeVisible();
    expect(await excerpt.textContent()).toBe(`你选中的${expected}`);
    await dock.getByRole("button", { name: "加入报告", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /报告第 2 版/ }),
    ).toBeVisible();
    await page.reload();
    const note = page.locator(".detail-screen [data-supplement-id]");
    await expect(note).toContainText(`${mode}只摘录正文`);
    expect(await note.locator(".jd-note-selection").textContent()).toBe(
      `你选中的：${expected}`,
    );
    expect(
      await note.evaluate((element) =>
        element.parentElement?.previousElementSibling?.getAttribute(
          "data-block-id",
        ),
      ),
    ).toBe(paragraph.blockId);
    const data = await readData(page);
    expect(data.supplements[0].anchor).toMatchObject({
      blockId: paragraph.blockId,
      start: 0,
      end: expected.length,
      exact: expected,
      prefix: "",
      suffix: "",
    });
    if (mode === "选区") {
      await note.scrollIntoViewIfNeeded();
      await snapshot(page, "fix1-supplement");
      await writeFile(
        ".cache/evidence/wo003-fix1-anchor.json",
        JSON.stringify(
          { raw, body: expected, anchor: data.supplements[0].anchor },
          null,
          2,
        ),
      );
    }
  });

test("模拟解答失败：问题已保存，先记下后刷新仍在，重试可加入报告", async ({
  page,
}) => {
  const id = await create(page);
  await helpers(page);
  await page.evaluate(
    (jobId) => (globalThis as unknown as Helpers).mountQuestionFailure(jobId),
    id,
  );
  const dock = page.getByRole("dialog", { name: "问一问", exact: true });
  await dock.getByRole("button", { name: "获取示例解答" }).click();
  await expect(dock.getByRole("alert")).toContainText("问题已经记下，不会丢");
  await snapshot(page, "question-failed");
  await dock.getByRole("button", { name: "先记下，稍后再问" }).click();
  await page.reload();
  const unanswered = page.locator('.jd-question-list [data-unanswered="true"]');
  await expect(unanswered).toContainText("未解答");
  await unanswered
    .getByRole("button", { name: "重试解答", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "问一问", exact: true })
      .getByRole("button", { name: "关闭问答卡", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("dialog", { name: "问一问", exact: true })
    .getByRole("button", { name: "获取示例解答" })
    .click();
  await page
    .getByRole("dialog", { name: "问一问", exact: true })
    .getByRole("button", { name: "加入报告", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /报告第 2 版/ })).toBeVisible();
  expect((await readData(page)).supplements).toHaveLength(1);
});

test("替换导入：先导出现有两份数据，再确认替换成文件里的一份", async ({
  page,
}) => {
  test.setTimeout(60000);
  await create(page);
  await page.getByRole("link", { name: "← 我的岗位" }).click();
  const original = await readData(page);
  await page.getByRole("link", { name: "贴一份新的 JD", exact: true }).click();
  await page.getByRole("button", { name: "试试示例", exact: true }).click();
  await page.keyboard.press("Control+Enter");
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await page.getByRole("link", { name: "← 我的岗位" }).click();
  await expect(page.locator("article.job")).toHaveCount(2);
  await page.getByRole("button", { name: "数据与备份", exact: true }).click();
  await chooseFile(page, original);
  await tabTo(page, page.getByRole("radio", { name: /合并（推荐）/ }));
  await page.keyboard.press("ArrowDown");
  await activate(
    page,
    page.getByRole("button", { name: "下一步", exact: true }),
  );
  const download = page.waitForEvent("download");
  await activate(
    page,
    page.getByRole("button", { name: "先导出现有数据", exact: true }),
  );
  const path = await (await download).path();
  if (!path) throw new Error("替换前没有导出文件");
  const protectedData = JSON.parse(await readFile(path, "utf8")) as Backup;
  expect(protectedData.jobs).toHaveLength(2);
  await expect(
    page.getByRole("button", { name: "确认替换", exact: true }),
  ).toBeEnabled();
  expect((await readData(page)).jobs).toHaveLength(2);
  await activate(
    page,
    page.getByRole("button", { name: "确认替换", exact: true }),
  );
  await activate(page, page.getByRole("button", { name: "好的", exact: true }));
  await expect(page.locator("article.job")).toHaveCount(1);
  const restored = await readData(page);
  for (const key of [
    "jobs",
    "sourceVersions",
    "reportVersions",
    "supplements",
  ] as const)
    expect(restored[key]).toEqual(original[key]);
  await expect(page.locator(".jd-backup-reminder")).toContainText(
    "上次备份后有新的改动",
  );
});
