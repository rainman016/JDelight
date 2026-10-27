import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import type { TrialExperienceHelpers } from "../browser/trial-experience";
let helperCode = "";
const invite = "ABCDEFGHJK";
const safari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const trialStatus = {
  mode: "trial",
  available: true,
  needCode: false,
  invalidCode: false,
  codeRemaining: 15,
  trialEnded: false,
  callLimitReached: false,
  unavailable: false,
  questionsRemaining: 20,
  questionCallLimitReached: false,
};
type Browser = typeof globalThis & { wo005: TrialExperienceHelpers };
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "error",
    resolve: {
      alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
    },
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(
          new URL("../browser/trial-experience.ts", import.meta.url),
        ),
        formats: ["iife"],
        name: "TrialExperienceContract",
      },
    },
  });
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((item) => ("output" in item ? item.output : []))
    .find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("试用夹具构建失败");
  helperCode = chunk.code;
  await mkdir(".cache/evidence", { recursive: true });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("jdelight-intro", "seen"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3100"
      ? route.continue()
      : route.abort(),
  );
});
async function helpers(page: Page) {
  if (!(await page.evaluate(() => !!(globalThis as Browser).wo005)))
    await page.addScriptTag({ content: helperCode });
}
async function seed(page: Page, count: number) {
  await page.goto("/");
  await helpers(page);
  return page.evaluate(
    (count) => (globalThis as Browser).wo005.seed(count),
    count,
  );
}
async function data(page: Page) {
  await helpers(page);
  return page.evaluate(() => (globalThis as Browser).wo005.data());
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({ path: `.cache/evidence/wo005-${name}.png` });
}
async function openQuestion(page: Page) {
  await page.getByRole("button", { name: /问这一节.*岗位定位/ }).click();
  const dock = page.getByRole("dialog", { name: "问一问", exact: true });
  await dock
    .getByRole("textbox", { name: "想问什么" })
    .fill("怎样理解这段岗位定位？");
  return dock;
}
for (const width of [1440, 390]) {
  test(`${width}：真实提问六种状态、保存类型、失败重试、加入报告与反馈避让`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (code) => localStorage.setItem("jdelight:invite", code),
      invite,
    );
    let remaining = 20;
    await page.route("**/api/analysis/status", (route) =>
      route.fulfill({
        json:
          route.request().headers()["x-jdelight-invite"] === invite
            ? { ...trialStatus, questionsRemaining: remaining }
            : {
                ...trialStatus,
                available: false,
                needCode: true,
                codeRemaining: 0,
                questionsRemaining: 0,
              },
      }),
    );
    let failed = false,
      calls = 0;
    let release = () => {};
    let gate: Promise<void> | null = null;
    await page.route("**/api/answer", async (route) => {
      calls++;
      const request = route.request(),
        body = request.postDataJSON();
      expect(request.headers()["x-jdelight-invite"]).toBe(invite);
      expect(Object.keys(body).sort()).toEqual([
        "jobId",
        "question",
        "selected",
        "source",
      ]);
      expect(body.source).toContain("岗位职责");
      expect(request.url()).not.toContain(invite);
      if (gate) await gate;
      if (failed)
        await route.fulfill({
          json: {
            ok: false,
            kind: "network",
            reasons: ["没有拿到解答，这次不扣次数。"],
          },
        });
      else {
        remaining--;
        await route.fulfill({
          json: {
            ok: true,
            answer: "可以从原文推断，需要与团队协作澄清需求。",
            kind: "inference",
            questionsRemaining: remaining,
          },
        });
      }
    });
    const [id] = await seed(page, 1);
    await page.goto(`/jobs/${id}`);
    await expect(page.getByRole("link", { name: "提意见" })).toBeVisible();
    let dock = await openQuestion(page);
    await expect(
      dock.getByRole("button", { name: "提问", exact: true }),
    ).toBeEnabled();
    await expect(dock).toContainText("这个码还剩 20 次提问");
    await expect(page.getByRole("link", { name: "提意见" })).toHaveCount(0);
    await shot(page, `${width}-question-ready`);
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await dock.getByRole("button", { name: "提问", exact: true }).click();
    await expect(dock).toContainText("正在获取解答…（约 10 秒）");
    await shot(page, `${width}-question-loading`);
    release();
    gate = null;
    await expect(dock).toContainText("可以从原文推断");
    await expect(dock.locator(".jd-answer-kind")).toHaveText("推断");
    await shot(page, `${width}-question-done`);
    expect((await data(page)).supplements[0].answerKind).toBe("inference");
    await dock.getByRole("button", { name: "加入报告", exact: true }).click();
    await expect(dock).toHaveCount(0);
    expect(calls).toBe(1);
    expect((await data(page)).reportVersions).toHaveLength(2);
    failed = true;
    dock = await openQuestion(page);
    await dock.getByRole("button", { name: "提问", exact: true }).click();
    await expect(dock.getByRole("alert")).toContainText("这次不扣次数");
    await shot(page, `${width}-question-failed`);
    expect(
      (await data(page)).supplements.filter(
        (note) => note.status === "unanswered",
      ),
    ).toHaveLength(1);
    failed = false;
    await dock.getByRole("button", { name: "重试", exact: true }).click();
    await expect(dock).toContainText("可以从原文推断");
    expect((await data(page)).supplements).toHaveLength(2);
    await dock.getByRole("button", { name: "关闭问答卡" }).click();
    remaining = 0;
    dock = await openQuestion(page);
    await expect(dock).toContainText("这个码的 20 次提问已用完");
    await expect(
      dock.getByRole("button", { name: "提问", exact: true }),
    ).toBeDisabled();
    await shot(page, `${width}-question-exhausted`);
    await dock.getByRole("button", { name: "关闭问答卡" }).click();
    await page.evaluate(() => localStorage.removeItem("jdelight:invite"));
    dock = await openQuestion(page);
    await expect(
      dock.getByRole("button", { name: "获取示例解答" }),
    ).toBeEnabled();
    await dock.getByRole("button", { name: "获取示例解答" }).click();
    await expect(dock).toContainText("示例解答 · 通常");
    await shot(page, `${width}-question-no-code`);
    expect(calls).toBe(3);
  });
  test(`${width}：微信与备份最多两条，导出清零，关闭跨页面保留`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (ua) =>
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          get: () => ua,
        }),
      safari + " MicroMessenger/8.0",
    );
    const ids = await seed(page, 3);
    await page.reload();
    await expect(
      page.getByRole("complementary", { name: "微信提示" }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "备份提醒" }),
    ).toContainText("新增 3 份报告");
    await expect(page.getByRole("complementary")).toHaveCount(2);
    await shot(page, `${width}-wechat-backup`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出备份", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/jdelight-备份/);
    await expect(
      page.getByRole("complementary", { name: "备份提醒" }),
    ).toHaveCount(0);
    await helpers(page);
    expect(
      (await page.evaluate(() => (globalThis as Browser).wo005.status()))
        .newReports,
    ).toBe(0);
    await page.goto("/new");
    await expect(
      page.getByRole("complementary", { name: "微信提示" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭微信提示" }).click();
    await page.goto(`/jobs/${ids[0]}`);
    await expect(
      page.getByRole("complementary", { name: "微信提示" }),
    ).toHaveCount(0);
  });
  test(`${width}：iPhone 提示、7 天备份优先级及关闭后刷新`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (ua) =>
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          get: () => ua,
        }),
      safari,
    );
    await seed(page, 1);
    await page.reload();
    await expect(
      page.getByRole("complementary", { name: "iPhone 提示" }),
    ).toBeVisible();
    await shot(page, `${width}-iphone`);
    await helpers(page);
    await page.evaluate(() => (globalThis as Browser).wo005.oldExport());
    await page.reload();
    await expect(
      page.getByRole("complementary", { name: "备份提醒" }),
    ).toContainText("超过 7 天");
    await expect(
      page.getByRole("complementary", { name: "iPhone 提示" }),
    ).toHaveCount(0);
    await shot(page, `${width}-backup-age`);
    await page.getByRole("button", { name: "关闭备份提醒" }).click();
    await expect(
      page.getByRole("complementary", { name: "iPhone 提示" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭iPhone 提示" }).click();
    await page.reload();
    await expect(page.getByRole("complementary")).toHaveCount(0);
  });
}
test("有码且有额度默认勾选真实分析，用户可以取消", async ({ page }) => {
  await page.addInitScript(
    (code) => localStorage.setItem("jdelight:invite", code),
    invite,
  );
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({ json: trialStatus }),
  );
  await page.goto("/new");
  await page.getByRole("button", { name: "试试示例" }).click();
  await page.getByRole("button", { name: "下一步：校对" }).click();
  const control = page.getByRole("switch", { name: /用真实 AI 分析/ });
  await expect(control).toBeChecked();
  await control.uncheck();
  await expect(control).not.toBeChecked();
});
