import { expect, test, type Page } from "@playwright/test";

async function dragQuote(page: Page, reverse: boolean) {
  const target = page.getByTestId("drag-target");
  const points = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      nodes.push(node);
    const first = document.createRange();
    first.setStart(nodes[0], 0);
    first.setEnd(nodes[0], 1);
    const last = document.createRange();
    const tail = nodes.at(-1)!;
    const length = tail.textContent!.length;
    last.setStart(tail, length - 1);
    last.setEnd(tail, length);
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    return {
      start: { x: a.left + 1, y: a.top + a.height / 2 },
      end: { x: b.right - 1, y: b.top + b.height / 2 },
    };
  });
  const start = reverse ? points.end : points.start;
  const end = reverse ? points.start : points.end;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 24 });
  await page.mouse.up();
  const exact = await target.textContent();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    exact,
  );
  return exact;
}

for (const mode of ["forward", "reverse", "mark"] as const) {
  test(`真实鼠标选区：${mode} 保存后刷新恢复原句`, async ({ page }) => {
    await page.goto(`/spike/anchor${mode === "mark" ? "?highlight=mark" : ""}`);
    const exact = await dragQuote(page, mode === "reverse");
    await page.getByRole("button", { name: "保存锚点", exact: true }).click();
    await expect(page.getByTestId("anchor-status")).toHaveText("saved");
    const anchor = JSON.parse(
      await page.getByTestId("anchor-record").innerText(),
    );
    expect(anchor.exact).toBe(exact);
    await page.reload();
    await expect(page.getByTestId("anchor-status")).toHaveText("restored");
    const highlightMode = await page.getByTestId("highlight-mode").innerText();
    expect(highlightMode).toBe(mode === "mark" ? "mark" : "css");
    const highlighted = await page.evaluate(() => {
      const ranges =
        typeof CSS !== "undefined" && "highlights" in CSS
          ? CSS.highlights.get("spike-anchor")
          : undefined;
      return ranges
        ? Array.from(ranges)
            .map((range) => range.toString())
            .join("")
        : Array.from(document.querySelectorAll("mark"))
            .map((mark) => mark.textContent)
            .join("");
    });
    expect(highlighted).toBe(anchor.exact);
  });
}

test("真实 IndexedDB：事务中途失败回滚，正常重试可提交", async ({ page }) => {
  await page.goto("/spike/anchor");
  await page.getByRole("button", { name: "验证事务回滚", exact: true }).click();
  await expect(page.getByTestId("db-result")).toContainText('"aborted"');
  const result = JSON.parse(await page.getByTestId("db-result").innerText());
  expect(result.aborted).toEqual({
    insertedInside: true,
    error: "模拟保存失败",
    newVersion: null,
    job: { id: "job-a", title: "虚构数据岗位", currentVersionId: "v1" },
    oldVersion: { id: "v1", jobId: "job-a", text: "旧报告内容" },
  });
  expect(result.committed).toEqual({
    currentVersionId: "v2",
    versions: 2,
    oldVersion: result.aborted.oldVersion,
  });
});

test("真实 IndexedDB：级联删除岗位与版本，其他岗位完好", async ({ page }) => {
  await page.goto("/spike/anchor");
  await page.getByRole("button", { name: "验证级联删除", exact: true }).click();
  await expect(page.getByTestId("db-result")).toContainText('"versions"');
  const result = JSON.parse(await page.getByTestId("db-result").innerText());
  expect(result.job).toBeNull();
  expect(result.versions).toEqual([]);
  expect(result.otherJob.id).toBe("job-b");
  expect(result.otherVersion.text).toBe("其他岗位报告");
});

test("真实 IndexedDB：v1 到 v2 结构升级保留旧数据", async ({ page }) => {
  await page.goto("/spike/anchor");
  await page.getByRole("button", { name: "验证结构升级", exact: true }).click();
  await expect(page.getByTestId("db-result")).toContainText('"version"');
  expect(JSON.parse(await page.getByTestId("db-result").innerText())).toEqual({
    version: 2,
    jobs: [
      {
        id: "job-a",
        title: "虚构数据岗位",
        currentVersionId: "v1",
        status: "preparing",
      },
    ],
    versions: [{ id: "v1", jobId: "job-a", text: "旧报告内容" }],
  });
});

test("真实 IndexedDB：独立数据库并发运行且清理完毕", async ({ page }) => {
  await page.goto("/spike/anchor");
  await page.getByRole("button", { name: "验证测试隔离", exact: true }).click();
  await expect(page.getByTestId("db-result")).toContainText('"deleted"');
  const result = JSON.parse(await page.getByTestId("db-result").innerText());
  expect(result.results[0].name).not.toBe(result.results[1].name);
  expect(result.results.map(({ title }: { title: string }) => title)).toEqual([
    "甲",
    "乙",
  ]);
  expect(result.deleted).toEqual([true, true]);
});
