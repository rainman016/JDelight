import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const fixture = JSON.parse(
  await readFile(
    new URL("../../fixtures/sample-report.json", import.meta.url),
    "utf8",
  ),
);
const code = "ABCDEFGHJK";
const status = {
  mode: "trial",
  available: false,
  needCode: true,
  invalidCode: false,
  codeRemaining: 0,
  trialEnded: false,
  callLimitReached: false,
  questionsRemaining: 0,
  questionCallLimitReached: false,
  unavailable: false,
};
async function tabTo(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true });
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("未能用键盘走到指定按钮");
}
async function confirm(page: Page) {
  await page.goto("/new");
  await page.getByRole("button", { name: "试试示例" }).click();
  await page.getByRole("button", { name: "下一步：校对" }).click();
}
async function shot(page: Page, name: string) {
  await mkdir(".cache/evidence", { recursive: true });
  await page.locator(".trial-access").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({ path: `.cache/evidence/wo004-${name}.png` });
}
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
for (const width of [1440, 390])
  test(`${width}：邀请码 A–D、键盘确认、更换、私有值不进页面`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    let state = "A";
    await page.route("**/api/analysis/status", (route) => {
      const invite = route.request().headers()["x-jdelight-invite"];
      const value =
        state === "D"
          ? { ...status, needCode: false, trialEnded: true }
          : state === "C"
            ? { ...status, needCode: false }
            : invite === code
              ? {
                  ...status,
                  available: true,
                  needCode: false,
                  codeRemaining: 15,
                }
              : invite
                ? { ...status, needCode: false, invalidCode: true }
                : status;
      return route.fulfill({ json: value });
    });
    await confirm(page);
    await expect(page.getByRole("switch")).toHaveCount(0);
    await shot(page, `${width}-A`);
    await tabTo(page, "有邀请码？用真实 AI 分析");
    await page.keyboard.press("Enter");
    const input = page.getByRole("textbox", { name: "邀请码", exact: true });
    await input.focus();
    await page.keyboard.type("ABCDE-FGHJM");
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".trial-access").getByRole("alert"),
    ).toContainText("邀请码不对");
    await input.fill("abcde-fghjk");
    await page.keyboard.press("Enter");
    const toggle = page.getByRole("switch", {
      name: "用真实 AI 分析（这个码还剩 15 份）",
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    expect(
      await page.evaluate(() => localStorage.getItem("jdelight:invite")),
    ).toBe(code);
    await shot(page, `${width}-B`);
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    await page.getByRole("button", { name: "更换邀请码", exact: true }).click();
    await expect(input).toBeVisible();
    await input.fill("abcde-fghjk");
    await page.keyboard.press("Enter");
    await expect(toggle).toBeChecked();
    state = "C";
    await page.reload();
    await page.getByRole("button", { name: "试试示例" }).click();
    await page.getByRole("button", { name: "下一步：校对" }).click();
    await expect(
      page.getByText("这个邀请码的 15 份已用完，请联系发码人。", {
        exact: true,
      }),
    ).toBeVisible();
    await shot(page, `${width}-C`);
    state = "D";
    await page.reload();
    await page.getByRole("button", { name: "试试示例" }).click();
    await page.getByRole("button", { name: "下一步：校对" }).click();
    await expect(
      page.getByText("试用额度已用完，感谢参与！现在仍可使用模拟分析。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
    await shot(page, `${width}-D`);
    expect(page.url()).not.toContain(code);
    expect(await page.locator("body").innerText()).not.toMatch(
      /总花费|30_000_000|UPSTASH|EASYROUTER|JDELIGHT_INVITE_HASHES/,
    );
  });
test("邀请码刷新保留、成功请求只在头部带码，无码仍可模拟", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("jdelight:invite", "ABCDEFGHJK"),
  );
  await page.route("**/api/analysis/status", (route) => {
    expect(route.request().headers()["x-jdelight-invite"]).toBe(code);
    expect(route.request().url()).not.toContain(code);
    return route.fulfill({
      json: { ...status, needCode: false, available: true, codeRemaining: 14 },
    });
  });
  await page.route("**/api/analysis", async (route) => {
    const request = route.request();
    expect(request.headers()["x-jdelight-invite"]).toBe(code);
    expect(request.url()).not.toContain(code);
    const body = request.postDataJSON();
    expect(body).not.toHaveProperty("invite");
    await route.fulfill({
      json: {
        ok: true,
        content: {
          ...fixture,
          sourceVersionId: body.id,
          origin: "model",
          ruleVersion: "prompt-3",
        },
      },
    });
  });
  await confirm(page);
  await page.getByRole("switch").check();
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(page.getByText(/真实分析/).first()).toBeVisible();
});
test("无码能完成模拟流程；本地存储被禁用时仍可用邀请码完成本页请求", async ({
  page,
}) => {
  let accepted = false;
  await page.route("**/api/analysis/status", (route) =>
    route.fulfill({
      json:
        route.request().headers()["x-jdelight-invite"] === code
          ? { ...status, needCode: false, available: true, codeRemaining: 15 }
          : status,
    }),
  );
  await confirm(page);
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("disabled");
      },
    });
  });
  await confirm(page);
  await page.getByRole("button", { name: "有邀请码？用真实 AI 分析" }).click();
  await page
    .getByRole("textbox", { name: "邀请码", exact: true })
    .fill("abcde-fghjk");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("switch")).toBeVisible();
  await page.route("**/api/analysis", (route) => {
    accepted = route.request().headers()["x-jdelight-invite"] === code;
    return route.fulfill({
      json: {
        ok: false,
        kind: "network",
        reasons: ["仅测试：模拟取消后的失败"],
      },
    });
  });
  await page.getByRole("switch").check();
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(
    page.getByText("这次分析没通过检查，没有展示", { exact: true }),
  ).toBeVisible();
  expect(accepted).toBe(true);
});
