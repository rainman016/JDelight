import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("生产首页可访问、无严重无障碍违规或控制台错误", async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin !== "http://127.0.0.1:3100") {
      externalRequests.push(route.request().url());
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "JDelight", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("骨架已就绪，功能在后续工单中实现"),
  ).toBeVisible();
  await expect(
    page.getByText("数据只保存在这台设备的这个浏览器里"),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
