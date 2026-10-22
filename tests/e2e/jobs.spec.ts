import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
const sample = JSON.parse(
  readFileSync(
    new URL("../../fixtures/sample-jd.json", import.meta.url),
    "utf8",
  ),
) as string;

const evidence = ".cache/evidence";
async function snapshot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
}
async function tabTo(page: Page, locator: Locator) {
  for (let i = 0; i < 100; i++) {
    if (await locator.evaluate((el) => document.activeElement === el)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`键盘无法走到 ${await locator.textContent()}`);
}
for (const width of [1440, 390])
  test(`${width}：键盘新建、校对、保存刷新、标记、备注、两步删除`, async ({
    page,
  }) => {
    const errors: string[] = [],
      external: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).origin !== "http://127.0.0.1:3100") {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const enter = page.getByRole("button", { name: "开始：进入我的岗位" });
    await expect(enter).toBeVisible();
    await expect(page.locator(".intro")).toHaveAttribute("data-done", "true");
    await expect(page.locator(".intro canvas")).toHaveCount(0);
    await tabTo(page, enter);
    await page.keyboard.press("Enter");
    await expect(page.getByText("还没有岗位", { exact: true })).toBeVisible();
    const paste = page.getByRole("link", { name: "贴一份 JD", exact: true });
    await tabTo(page, paste);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "岗位描述", exact: true }),
    ).toBeFocused();
    await snapshot(page, `${width}-input`);
    await tabTo(page, page.getByRole("button", { name: "试试示例" }));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+Enter");
    await expect(
      page.getByRole("heading", { name: "先校对一下原文" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "岗位名称" })).toHaveValue(
      "初级 AI Agent 产品经理",
    );
    await expect(
      page.getByRole("textbox", { name: "公司", exact: true }),
    ).toHaveValue("星桥科技");
    await expect(page.getByRole("textbox", { name: "地点" })).toHaveValue(
      "上海",
    );
    await snapshot(page, `${width}-confirm`);
    await tabTo(page, page.getByRole("button", { name: "确认原文，开始分析" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(
      page.getByText("报告第 1 版 · 示例分析", { exact: true }),
    ).toBeVisible();
    const jobUrl = page.url();
    await snapshot(page, `${width}-job`);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "初级 AI Agent 产品经理" }),
    ).toBeVisible();
    const back = page.getByRole("link", { name: "← 我的岗位" });
    await tabTo(page, back);
    await page.keyboard.press("Enter");
    await expect(page.locator("article.job")).toHaveCount(1);
    await page.reload();
    await expect(page.locator("article.job")).toHaveCount(1);
    await snapshot(page, `${width}-home`);
    await tabTo(page, page.getByRole("button", { name: "我的标记：准备中" }));
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "我的标记：已面试" }),
    ).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "+ 备注" }));
    await page.keyboard.press("Enter");
    await page
      .getByRole("textbox", { name: "备注", exact: true })
      .fill("周五下午面试");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "修改备注：周五下午面试" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "我的标记：已面试" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "修改备注：周五下午面试" }),
    ).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "删除", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.locator("article.job")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "删除", exact: true }),
    ).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "删除", exact: true }));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByText("还没有岗位", { exact: true })).toBeVisible();
    await page.goto(jobUrl);
    await expect(
      page.getByRole("heading", { name: "没找到这个岗位" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
test("失败不展示报告，保存原文后从待分析卡重试", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/new?demo=fail");
  await page.getByRole("button", { name: "试试示例" }).click();
  await page.getByRole("button", { name: "下一步：校对" }).click();
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await expect(
    page.getByRole("heading", { name: "这次分析没通过检查，没有展示" }),
  ).toBeVisible();
  await expect(page.getByText(/被写成了必备/, { exact: false })).toBeVisible();
  await snapshot(page, "failure");
  // 从新建直达时尚未看开场；返回首页仍应先显示该会话首次开场。
  await page.getByRole("link", { name: "先保存原文，稍后再试" }).click();
  await page.getByRole("button", { name: "开始：进入我的岗位" }).click();
  await expect(page.getByText("待分析", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "重新分析", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(page.getByText("报告第 1 版 · 示例分析")).toBeVisible();
});
test("截断 JD 两条警示；未到 40 字和超限可恢复；连点不创建第二岗位", async ({
  page,
}) => {
  await page.goto("/new");
  const input = page.getByRole("textbox", { name: "岗位描述", exact: true });
  await input.fill("岗位");
  await expect(
    page.getByRole("button", { name: "下一步：校对" }),
  ).toBeDisabled();
  await input.fill("字".repeat(12001));
  await expect(input).toHaveValue("字".repeat(12001));
  await expect(
    page.getByRole("button", { name: "下一步：校对" }),
  ).toBeDisabled();
  await input.fill(
    "岗位名称：虚构产品经理\n公司：虚构星桥科技 · 上海\n岗位职责\n1. 负责调研用户需求，与研发沟通，推进设计和上线，",
  );
  await page.getByRole("button", { name: "下一步：校对" }).click();
  await expect(page.locator('.cf-note[data-level="warn"]')).toHaveCount(2);
  const warning = page.locator('.cf-line[data-flag="true"]');
  await expect(warning).toContainText("推进设计和上线，");
  await expect(warning).toHaveCSS("box-shadow", /169, 67, 31/);
  await snapshot(page, "truncated-confirm");
  await page.getByRole("button", { name: "确认原文，开始分析" }).dblclick();
  await expect(page).toHaveURL(/\/jobs\//);
  await expect(page.locator(".gist-text")).toContainText(
    "示例分析：真实内容由分析生成",
  );
  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("jdelight");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("jobs").objectStore("jobs").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  });
  expect(count).toBe(1);
});
test("直接访问新建和岗位路由不加载 three；记录各路由脚本清单", async ({
  browser,
}) => {
  await mkdir(evidence, { recursive: true });
  for (const path of ["/new", "/jobs/not-a-job", "/"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const urls = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((url) => /\.js(?:\?|$)/.test(url)),
    );
    await writeFile(
      `${evidence}/scripts-${path === "/" ? "home" : path === "/new" ? "new" : "job"}.json`,
      JSON.stringify(urls, null, 2),
    );
    if (path !== "/") {
      const contents = await Promise.all(
        urls.map(async (url) => (await context.request.get(url)).text()),
      );
      expect(
        contents.some((text) => text.includes("THREE.WebGLRenderer")),
      ).toBe(false);
    }
    await context.close();
  }
});

test("四种便利贴、叠放整理、筛选计数，备注 Esc 放弃与清空", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("jdelight-intro", "seen"),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (let i = 1; i <= 4; i++) {
    await page.goto("/new");
    await page
      .getByRole("textbox", { name: "岗位描述", exact: true })
      .fill(sample);
    await page.getByRole("button", { name: "下一步：校对" }).click();
    await page.getByRole("textbox", { name: "岗位名称" }).fill(`虚构岗位 ${i}`);
    await page.getByRole("button", { name: "确认原文，开始分析" }).click();
    await expect(page).toHaveURL(/\/jobs\//);
  }
  await page.goto("/");
  await expect(page.locator(".cards.piled")).toBeVisible();
  await page.getByRole("button", { name: "整理开：虚构岗位 4" }).click();
  await expect(page.locator(".cards.spread")).toBeVisible();
  const colors = await page
    .locator("article.job")
    .evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).getPropertyValue("--note").trim()),
    );
  expect(new Set(colors).size).toBe(4);
  await snapshot(page, "1440-four-notes");
  const first = page.locator("article.job").first();
  await first.getByRole("button", { name: "+ 备注" }).click();
  await page
    .getByRole("textbox", { name: "备注", exact: true })
    .fill("保存这句");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "修改备注：保存这句" }).click();
  await page
    .getByRole("textbox", { name: "备注", exact: true })
    .fill("放弃这句");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "修改备注：保存这句" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "整理开", exact: true }).click();
  await page.getByRole("button", { name: "修改备注：保存这句" }).click();
  await page.getByRole("textbox", { name: "备注", exact: true }).fill("");
  await page.keyboard.press("Enter");
  await expect(page.locator(".note-mini")).toHaveCount(0);
  await page
    .locator("article.job")
    .first()
    .getByRole("button", { name: "我的标记：准备中" })
    .click();
  await page.getByRole("menuitemradio", { name: "已放弃" }).click();
  const filters = page.getByRole("group", { name: "按标记筛选" });
  await expect(
    filters.getByRole("button", { name: /已放弃\s*1/ }),
  ).toBeVisible();
  await filters.getByRole("button", { name: /已放弃\s*1/ }).click();
  await expect(page.locator("article.job")).toHaveCount(1);
  await filters.getByRole("button", { name: /已面试\s*0/ }).click();
  await expect(page.getByText("这里空空的", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "看全部", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await snapshot(page, "390-four-notes");
});
test("取消回校对且不改写已确认原文；刷新后待分析可恢复", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("jdelight-intro", "seen"),
  );
  await page.goto("/new");
  await page
    .getByRole("textbox", { name: "岗位描述", exact: true })
    .fill(
      "岗位职责\n" +
        "负责虚构产品的调研和设计。\n".repeat(160) +
        "任职要求\n具备产品设计能力。",
    );
  await page.getByRole("button", { name: "下一步：校对" }).click();
  await page.getByRole("button", { name: "确认原文，开始分析" }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "先校对一下原文" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "岗位名称" })).toBeDisabled();
  await page.getByRole("link", { name: "返回我的岗位", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.reload();
  await expect(page.locator("article.job")).toHaveCount(1);
  await page.getByRole("link", { name: "重新分析", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\//);
});

test("普通开场可进入，运行中切换减少动态效果能释放 3D 并显示最终态", async ({
  page,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin !== "http://127.0.0.1:3100") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".intro")).toHaveAttribute("data-done", "true");
  await snapshot(page, "1440-intro");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".intro")).toHaveAttribute("data-renderer", "css");
  await expect(page.locator(".intro canvas")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await snapshot(page, "390-intro-reduced");
  await page.getByRole("button", { name: "开始：进入我的岗位" }).click();
  await expect(
    page.getByRole("heading", { name: "我的岗位", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".intro")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
