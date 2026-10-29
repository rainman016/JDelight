import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const source = [
  "岗位名称：虚构产品…体验专员",
  "公司：纸舟测试科技",
  "工作地点：测试城市",
  "岗位职责",
  "负责虚构产品的需求整理、访谈记录与交付跟进。",
  "任职要求",
  "能够清晰表达需求，并与团队讨论虚构项目的进度。",
].join("\n");

test.beforeAll(async () => {
  await mkdir(".cache/evidence", { recursive: true });
});

for (const width of [1440, 390])
  test(`${width}：校对省略号提示，报告和打印使用确认字段原样展示`, async ({
    page,
  }) => {
    const modelRequests: string[] = [];
    await page.route(/^https?:\/\//, (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.route("**/api/**", (route) => {
      if (route.request().method() === "POST")
        modelRequests.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 503, json: {} });
    });
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/new");
    await page.locator("#jd").fill(source);
    await page.getByRole("button", { name: /下一步：校对/ }).click();
    const notes = page.getByRole("list", { name: "检查结果" });
    await expect(notes).toContainText(
      "第 1 行有省略号，原文可能不完整；分析不会补全。",
    );
    await expect(notes).not.toContainText("没发现被截断");
    const title = "虚构产品...研究专员";
    const company = "纸舟...试验室";
    await page.getByLabel("岗位名称", { exact: true }).fill(title);
    await page.getByLabel("公司", { exact: true }).fill(company);
    await expect(notes).toContainText(
      "岗位名称有省略号，原文可能不完整；分析不会补全。",
    );
    await expect(notes).toContainText(
      "公司有省略号，原文可能不完整；分析不会补全。",
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `.cache/evidence/wo008-confirm-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "确认原文，开始分析" }).click();
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(page.locator(".d-head h1")).toHaveText(title);
    await expect(page.locator(".d-head .d-where")).toContainText(company);
    await expect(page.locator(".d-head .jd-source-incomplete")).toHaveText(
      "原文不完整",
    );
    await expect(page.locator(".jd-source")).toContainText(
      "岗位名称：虚构产品…体验专员",
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `.cache/evidence/wo008-report-${width}.png`,
    });
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".report-print header h1")).toHaveText(title);
    await expect(page.locator(".report-print header")).toContainText(company);
    await expect(
      page.locator(".report-print header .jd-source-incomplete"),
    ).toBeVisible();
    expect(modelRequests).toEqual([]);
  });
