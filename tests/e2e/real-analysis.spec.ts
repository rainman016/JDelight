import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const fixture = JSON.parse(
  await readFile(
    new URL("../../fixtures/sample-report.json", import.meta.url),
    "utf8",
  ),
);
const ready = {
  available: true,
  uiRemaining: 2,
  used: 0,
  maxCalls: 10,
  costUsedCny: 0,
  maxCostCny: 5,
};
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
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({ json: ready }),
  );
});
async function confirm(page: Page) {
  await page.goto("/new");
  await page.getByRole("button", { name: "试试示例" }).click();
  await page.getByRole("button", { name: "下一步：校对" }).click();
}
async function real(page: Page) {
  await confirm(page);
  const toggle = page.getByRole("switch");
  await expect(toggle).toHaveAccessibleName("用真实 AI 分析（还剩 2 次）");
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
}
async function shot(page: Page, name: string) {
  await mkdir(".cache/evidence", { recursive: true });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: `.cache/evidence/${name}.png`,
    fullPage: true,
  });
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
}
for (const width of [1440, 390]) {
  test(`${width}：默认关闭、键盘打开、成功来源标识与校对截图`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/analysis", async (route) => {
      const source = route.request().postDataJSON();
      expect(Object.keys(source).sort()).toEqual(["id", "lines", "text"]);
      await route.fulfill({
        json: {
          ok: true,
          content: {
            ...fixture,
            sourceVersionId: source.id,
            origin: "model",
            ruleVersion: "prompt-1",
          },
        },
      });
    });
    await real(page);
    await shot(page, `${width}-real-confirm`);
    await page.getByRole("button", { name: "确认原文，开始分析" }).click();
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(
      page.getByText("报告第 1 版 · 真实分析", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("报告第 1 版 · 真实分析", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "← 我的岗位" }).click();
    await expect(
      page
        .locator("article.job")
        .getByText("报告第 1 版 · 真实分析", { exact: true }),
    ).toBeVisible();
  });
  test(`${width}：额度用完页面、示例出口、axe 与无横向滚动`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/analysis", (route) =>
      route.fulfill({
        json: {
          ok: false,
          kind: "quota",
          reasons: ["本机最多 10 次真实调用，已用 10 次，不会自动恢复"],
        },
      }),
    );
    await real(page);
    await page.route("**/api/analysis/status", (route) =>
      route.fulfill({
        json: {
          ...ready,
          available: false,
          uiRemaining: 0,
          used: 10,
          costUsedCny: 1.25,
        },
      }),
    );
    await page.getByRole("button", { name: "确认原文，开始分析" }).click();
    await expect(
      page.getByRole("heading", { name: "本机的真实分析次数已用完" }),
    ).toBeVisible();
    await expect(page.getByText(/已用 10 次、约 ¥1.2500/)).toBeVisible();
    await shot(page, `${width}-real-quota`);
    const mock = page.getByRole("button", { name: "用示例分析看看效果" });
    await mock.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(
      page.getByText("报告第 1 版 · 示例分析", { exact: true }),
    ).toBeVisible();
  });
  test(`${width}：不合格原因、重试按钮及失败页截图`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/analysis", (route) =>
      route.fulfill({
        json: {
          ok: false,
          kind: "check",
          reasons: ["第 6 行的引用和原文对不上", "优先条件被写成了必备要求"],
        },
      }),
    );
    await real(page);
    await page.getByRole("button", { name: "确认原文，开始分析" }).click();
    await expect(
      page.getByRole("heading", { name: "这次分析没通过检查，没有展示" }),
    ).toBeVisible();
    await expect(page.getByText("第 6 行的引用和原文对不上")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "重新分析（还剩 2 次）" }),
    ).toBeVisible();
    await shot(page, `${width}-real-failure`);
  });
}
test("无配置不出现开关，模拟照旧", async ({ page }) => {
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({ json: { ...ready, available: false, uiRemaining: 0 } }),
  );
  let posts = 0;
  await page.route("**/api/analysis", (route) => {
    posts++;
    return route.abort();
  });
  await confirm(page);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(
    page.getByText("报告第 1 版 · 示例分析", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
});
test("额度用完可以只保存原文，刷新后仍待分析", async ({ page }) => {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({
      json: {
        ok: false,
        kind: "quota",
        reasons: ["本机额度已用完，不会自动恢复"],
      },
    }),
  );
  await real(page);
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await page.getByRole("link", { name: "只保存原文", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.reload();
  await expect(page.locator("article.job")).toHaveCount(1);
  await expect(page.getByText("待分析", { exact: true })).toBeVisible();
});
test("界面剩余一次显示 1，金额不足时无开关", async ({ page }) => {
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({ json: { ...ready, used: 1, uiRemaining: 1 } }),
  );
  await confirm(page);
  await expect(page.getByRole("switch")).toHaveAccessibleName(
    "用真实 AI 分析（还剩 1 次）",
  );
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({
      json: {
        ...ready,
        used: 1,
        costUsedCny: 4.9,
        available: false,
        uiRemaining: 0,
      },
    }),
  );
  await confirm(page);
  await expect(page.getByRole("switch")).toHaveCount(0);
});
test("真实等待显示秒数，取消中止等待且原文仍可恢复", async ({ page }) => {
  let requested = false;
  await page.route("**/api/analysis", async (route) => {
    requested = true;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route
      .fulfill({
        json: { ok: false, kind: "network", reasons: ["请求超时，本次仍计次"] },
      })
      .catch(() => {});
  });
  await real(page);
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(
    page.getByRole("heading", { name: "等待模型返回" }),
  ).toBeVisible();
  await expect(page.locator(".big-count")).toContainText("秒 · 已等待");
  await expect(page.locator(".big-count")).toContainText("1", {
    timeout: 2000,
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "先校对一下原文" }),
  ).toBeVisible();
  await expect(page.locator(".inline-error")).toContainText(
    "已经发出的真实调用仍计次",
  );
  await expect(page.getByRole("textbox", { name: "岗位名称" })).toBeDisabled();
});
test("网络超时原因清楚显示并保留重试入口", async ({ page }) => {
  await page.route("**/api/analysis", (route) =>
    route.fulfill({
      json: {
        ok: false,
        kind: "network",
        reasons: ["模型请求等待 90 秒后超时，本次仍计次；原文已保留，可以重试"],
      },
    }),
  );
  await real(page);
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(
    page.getByText(
      "模型请求等待 90 秒后超时，本次仍计次；原文已保留，可以重试",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /重新分析/ })).toBeVisible();
});
