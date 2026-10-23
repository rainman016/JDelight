import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { JDelightDatabase } from "../data/database";
import { withIsolatedDatabase } from "../../tests/helpers/database-isolation";
import { detailFixture } from "../../tests/helpers/detail-fixture";
import { reportText, SECTION_TITLES } from "./report-presentation";

test("导出使用所选版本快照，含全章、程度、出处、边界，不混入当前补充与私有备注", async () => {
  await withIsolatedDatabase(async (scope) => {
    const fixture = await detailFixture(
      scope.track(new JDelightDatabase(scope.name)),
    );
    const job = { ...fixture.job, note: "私有备注不应导出" };
    const old = reportText(job, fixture.second, fixture.source);
    const current = reportText(job, fixture.third, fixture.source);
    for (const heading of Object.values(SECTION_TITLES))
      expect(old).toContain(heading);
    expect(old).toContain("报告第 2 版");
    expect(old).toContain("旧版本里的解释。");
    expect(old).not.toContain("当前版本里的新解释。");
    expect(current).toContain("当前版本里的新解释。");
    expect(reportText(job, fixture.first, fixture.source)).not.toContain(
      fixture.second.supplements[0].question,
    );
    expect(old).toContain("优先，不是必须");
    expect(old).toContain("原文没写");
    expect(old).toContain("职责第 2 条");
    expect(old).toContain(fixture.source.text.split("\n")[0]);
    expect(old).not.toContain(job.note);
    expect(old).not.toContain("ruleVersion");
    expect(old).not.toContain("preparing");
    expect(old).toContain("推测");
    expect(old).toContain("通常");
  });
});
