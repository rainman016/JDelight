import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

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
          new URL("../browser/detail-contract.ts", import.meta.url),
        ),
        formats: ["iife"],
        name: "DetailContract",
      },
    },
  });
  const chunk = (Array.isArray(bundle) ? bundle : [bundle])
    .flatMap((result) => ("output" in result ? result.output : []))
    .find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("浏览器测试打包失败");
  code = chunk.code;
  await mkdir(".cache/evidence", { recursive: true });
});
type BrowserHelpers = {
  seedDetail: () => Promise<{
    jobId: string;
    firstId: string;
    secondId: string;
    thirdId: string;
  }>;
  runUpgradeContract: () => Promise<{ passed: boolean; schemaVersion: number }>;
};
async function seed(page: Page) {
  await page.goto("/new");
  await page.addScriptTag({ content: code });
  const ids = await page.evaluate(() =>
    (globalThis as unknown as BrowserHelpers).seedDetail(),
  );
  await page.goto(`/jobs/${ids.jobId}`);
  await expect(page.getByRole("button", { name: /报告第 3 版/ })).toBeVisible();
  return ids;
}
async function snapshot(page: Page, name: string) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.evaluate(() => document.fonts.ready);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({
    path: `.cache/evidence/wo003-${name}.png`,
    fullPage: true,
  });
  await page.screenshot({ path: `.cache/evidence/wo003-${name}-viewport.png` });
}
test("真实 Chromium：v1 原始五表升级为 v2、保留数据且旧版本仍不可变", async ({
  page,
}) => {
  await page.goto("/new");
  await page.addScriptTag({ content: code });
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as BrowserHelpers).runUpgradeContract(),
    ),
  ).toEqual({ passed: true, schemaVersion: 2 });
});

for (const width of [1440, 390])
  test(`${width}：完整报告、出处、速览、版本菜单、导出弹层`, async ({
    page,
  }) => {
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
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await seed(page);
    for (const title of [
      "岗位定位",
      "任职门槛",
      "隐含要求",
      "能力解析",
      "场景推测",
      "准备建议",
      "待确认事项",
    ])
      await expect(
        page.getByRole("heading", { name: new RegExp(title) }),
      ).toBeVisible();
    await expect(page.locator(".jd-thread")).toHaveCount(0);
    await page.evaluate(() => scrollTo(0, 0));
    await snapshot(page, `${width}-report`);
    const cite = page.locator(".jd-first .cite").first();
    await cite.click();
    if (width >= 900) {
      await expect(page.locator(".jd-thread path")).toHaveCount(1);
      const geometry = async () =>
        page.evaluate(() => {
          const from = document
            .querySelector('.cite[aria-pressed="true"]')!
            .getBoundingClientRect();
          const to = document
            .querySelector('.jd-source-line[data-highlighted="true"]')!
            .getBoundingClientRect();
          const circle = document.querySelector(".jd-thread circle")!;
          const path = document
            .querySelector(".jd-thread path")!
            .getAttribute("d")!;
          const start = path.match(/^M([\d.-]+),([\d.-]+)/)!;
          return {
            targetX: Math.abs(Number(circle.getAttribute("cx")) - to.right - 2),
            targetY: Math.abs(
              Number(circle.getAttribute("cy")) - to.top - to.height / 2,
            ),
            startX: Math.abs(Number(start[1]) - from.left),
            startY: Math.abs(Number(start[2]) - from.top - from.height / 2),
          };
        });
      await expect
        .poll(async () => Math.max(...Object.values(await geometry())))
        .toBeLessThan(1);
      await writeFile(
        `.cache/evidence/wo003-${width}-thread-geometry.json`,
        JSON.stringify(await geometry(), null, 2),
      );
      await page.screenshot({
        path: `.cache/evidence/wo003-${width}-citation.png`,
      });
      await page.evaluate(() => scrollBy(0, 70));
      await expect
        .poll(async () => Math.max(...Object.values(await geometry())))
        .toBeLessThan(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".jd-thread")).toHaveCount(0);
    } else {
      await expect(page.getByRole("dialog", { name: /原文/ })).toBeVisible();
      await expect(page.getByRole("dialog").locator("mark")).not.toBeEmpty();
      await expect(page.locator(".jd-thread")).toHaveCount(0);
      await snapshot(page, `${width}-citation`);
      await page.keyboard.press("Escape");
      await expect(cite).toBeFocused();
      await cite.click();
      await page.getByRole("button", { name: "在原文里看" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("complementary", { name: "JD 原文" }),
      ).toBeFocused();
      await expect(
        page.locator('.jd-source-line[data-highlighted="true"]'),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
    }
    const reportTab = page.getByRole("tab", { name: "完整报告" });
    await reportTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "面试前速览" })).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "最该准备的重点" }),
    ).toBeVisible();
    await expect(
      page.getByText("为什么要问：", { exact: false }).first(),
    ).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await snapshot(page, `${width}-brief`);
    await page.locator(".jd-brief-paper .cite").first().click();
    await expect(page.getByRole("dialog", { name: /原文/ })).toBeVisible();
    await page.keyboard.press("Escape");
    const versionButton = page.getByRole("button", { name: /报告第 3 版/ });
    await versionButton.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitemradio", { name: /第 3 版/ }),
    ).toBeFocused();
    await snapshot(page, `${width}-versions`);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("旧版本只读");
    await page.getByRole("tab", { name: "完整报告" }).click();
    await expect(page.locator(".detail-screen .jd-supplements")).toContainText(
      "旧版本里的解释。",
    );
    await expect(page.locator(".detail-screen .jd-report")).not.toContainText(
      "当前版本里的新解释。",
    );
    await page.getByRole("button", { name: "回到当前第 3 版" }).click();
    await expect(page.locator(".detail-screen .jd-supplements")).toContainText(
      "当前版本里的新解释。",
    );
    const exportButton = page.getByRole("button", {
      name: "导出报告",
      exact: true,
    });
    await exportButton.click();
    await snapshot(page, `${width}-export`);
    for (let index = 0; index < 9; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByRole("dialog")
          .evaluate((element) => element.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(exportButton).toBeFocused();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

test("复制和打印以所选旧版本为准，含出处与补充，不含当前版本的新解释", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ids = await seed(page);
  await page.getByRole("button", { name: "导出报告", exact: true }).click();
  await page.getByLabel("导出哪个版本").selectOption(ids.secondId);
  await expect(page.getByRole("dialog")).toContainText("你选的是旧版本");
  await page.getByRole("button", { name: "复制全文", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("报告第 2 版");
  expect(copied).toContain("旧版本里的解释。");
  expect(copied).not.toContain("当前版本里的新解释。");
  expect(copied).toContain("职责第 2 条");
  expect(copied).toContain("确认过的 JD 原文");
  expect(copied).not.toContain("ruleVersion");
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printed = "true";
    };
  });
  await page.getByRole("button", { name: "导出报告", exact: true }).click();
  await page.getByLabel("导出哪个版本").selectOption(ids.secondId);
  await page
    .getByRole("button", { name: "打印 / 存成 PDF", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-printed", "true");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".detail-screen")).toBeHidden();
  await expect(page.locator(".report-print")).toBeVisible();
  await expect(page.locator(".report-print")).toContainText("报告第 2 版");
  await expect(page.locator(".report-print")).toContainText("旧版本里的解释。");
  await expect(page.locator(".report-print")).not.toContainText(
    "当前版本里的新解释。",
  );
  await expect(page.getByRole("button")).toHaveCount(0);
  await page.screenshot({
    path: ".cache/evidence/wo003-print.png",
    fullPage: true,
  });
  await page.screenshot({ path: ".cache/evidence/wo003-print-viewport.png" });
});

test("复制权限失败保留弹层，关闭后可重新选择打印", async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("测试：拒绝复制")),
    });
  });
  const open = page.getByRole("button", { name: "导出报告", exact: true });
  await open.click();
  await page.getByRole("button", { name: "复制全文", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "浏览器没有允许复制",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await open.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "打印 / 存成 PDF", exact: true }),
  ).toBeEnabled();
});
