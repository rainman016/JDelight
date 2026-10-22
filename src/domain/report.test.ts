import { expect, test } from "vitest";
import { sourceLines, metaFrom, checksOf, citationLabel } from "./source";
import { ReportCheckError, validateReport } from "./report";
import { reportFor, SAMPLE_JD } from "../providers/mock";
import type { SourceVersion } from "./schema";
import invalidV2 from "../../fixtures/invalid-v2.json";
import invalidV4 from "../../fixtures/invalid-v4.json";
import invalidV5 from "../../fixtures/invalid-v5.json";
import invalidV6 from "../../fixtures/invalid-v6.json";
import type { Block } from "./report";
const source: SourceVersion = {
  id: "fixture-source",
  jobId: "fixture-job",
  no: 1,
  text: SAMPLE_JD,
  lines: sourceLines(SAMPLE_JD),
  confirmedAt: "2026-10-21T00:00:00.000Z",
};
test("完整示例与其他 JD 的占位报告都通过 V1–V7", () => {
  expect(validateReport(reportFor(source), source).sections).toHaveLength(7);
  const padded = {
    ...source,
    text: `\r\n${SAMPLE_JD.replace(/\n/g, "\r\n")}\r\n`,
  };
  padded.lines = sourceLines(padded.text);
  expect(validateReport(reportFor(padded), padded).focus.gist.text).toContain(
    "初级",
  );
  const other = {
    ...source,
    text: "虚构岗位\n岗位职责\n做用户调研\n任职要求\n本科及以上",
  };
  other.lines = sourceLines(other.text);
  expect(validateReport(reportFor(other), other).focus.gist.text).toContain(
    "示例分析",
  );
});
for (const [code, fixture, message] of [
  ["V2", invalidV2, "引用和原文对不上"],
  ["V4", invalidV4, "被写成了必备"],
  ["V5", invalidV5, "必须标为推测"],
  ["V6", invalidV6, "原文里找不到"],
] as const)
  test(`${code} 不合格夹具拒绝并给中文原因`, () => {
    try {
      validateReport(fixture, source);
      expect.fail("应拒绝不合格报告");
    } catch (error) {
      expect(error).toBeInstanceOf(ReportCheckError);
      expect((error as ReportCheckError).issues).toContainEqual(
        expect.objectContaining({
          code,
          message: expect.stringContaining(message),
        }),
      );
    }
  });
test("V1 拒绝章节换序，V3 拒绝无出处判断，V7 拒绝分数类额外字段", () => {
  const base = reportFor(source);
  const order = structuredClone(base);
  order.sections.reverse();
  expect(() => validateReport(order, source)).toThrow("顺序");
  const refs = structuredClone(base);
  refs.focus.gist.citations = [];
  expect(() => validateReport(refs, source)).toThrow("缺少原文出处");
  expect(() => validateReport({ ...base, score: 99 }, source)).toThrow("分数");
  const nested = structuredClone(base);
  Object.assign(nested.focus.items[0], { score: 99 });
  expect(() => validateReport(nested, source)).toThrow("分数");
});
function requiredAtMixedLine(phrase: string, quote = phrase) {
  const report = reportFor(source);
  const section = report.sections.find((s) => s.key === "thresholds")!;
  const requirement = section.blocks.find(
    (block): block is Extract<Block, { type: "requirement" }> =>
      block.type === "requirement",
  )!;
  section.blocks = [requirement];
  requirement.phrase = phrase;
  requirement.strength = "required";
  requirement.citations = [{ lineNo: 12, quote }];
  return { report, requirement };
}
test("V4：示例第 12 行混写时，本科必备通过，B 端或 AI 经验必备被拒", () => {
  expect(source.lines[11].text).toBe(
    "1. 本科及以上学历，2 年以上互联网产品经验，有 B 端或 AI 产品经验者优先。",
  );
  const required = requiredAtMixedLine("本科及以上学历");
  expect(() => validateReport(required.report, source)).not.toThrow();
  const preferred = requiredAtMixedLine("B 端或 AI 产品经验");
  expect(() => validateReport(preferred.report, source)).toThrow(
    "“B 端或 AI 产品经验”所在的优先或加分条件被写成了必备",
  );
});
test("V4：加分分区没有优先字样也拒绝 required；任一引用行命中就拒绝", () => {
  const { report, requirement } = requiredAtMixedLine("本科及以上学历");
  const bonus = source.lines.find(
    (line) => line.section === "bonus" && !line.heading && line.text.trim(),
  )!;
  expect(bonus.text).not.toMatch(/优先|加分/);
  requirement.citations.push({ lineNo: bonus.lineNo, quote: bonus.text });
  expect(() => validateReport(report, source)).toThrow("被写成了必备");
});
test("V4：phrase 跨分句时回退整行，仍拒绝升级", () => {
  const { report } = requiredAtMixedLine("学历，2 年以上互联网产品经验");
  expect(() => validateReport(report, source)).toThrow("被写成了必备");
});
test.each(["，", ",", "；", ";", "。", "！", "？"])(
  "V4：以 %s 分句；同一 phrase 多处出现时任一优先分句都不能升级",
  (separator) => {
    const { report } = requiredAtMixedLine("本科及以上学历");
    const changed = structuredClone(source);
    changed.lines[11].text = `${source.lines[11].text}${separator}本科及以上学历${separator}其他经验优先`;
    changed.text = changed.lines.map((line) => line.text).join("\n");
    expect(() => validateReport(report, changed)).not.toThrow();
    changed.lines[11].text = `${source.lines[11].text}${separator}本科及以上学历者优先`;
    changed.text = changed.lines.map((line) => line.text).join("\n");
    expect(() => validateReport(report, changed)).toThrow("被写成了必备");
  },
);
test("V6：phrase 只在引用行而不在 quote 中时拒绝；至少一条 quote 命中即可", () => {
  const { report, requirement } = requiredAtMixedLine(
    "本科及以上学历",
    "2 年以上互联网产品经验",
  );
  expect(() => validateReport(report, source)).toThrow(
    "要求“本科及以上学历”在引用行原文里找不到",
  );
  requirement.citations.push({ lineNo: 12, quote: "本科及以上学历" });
  expect(() => validateReport(report, source)).not.toThrow();
});
test("原文空行、缩进与 CRLF 保留；条目标签由分区计算", () => {
  const text =
    "岗位名称：虚构岗位\r\n\r\n岗位职责\r\n  1. 设计产品\r\n2. 测试\r\n任职要求\r\n本科";
  const lines = sourceLines(text);
  expect(lines[1].lineNo).toBe(2);
  expect(lines[1].text).toBe("");
  expect(lines[3].text).toBe("  1. 设计产品");
  expect(citationLabel(lines[4])).toBe("职责第 2 条");
  expect(citationLabel(source.lines.at(-1)!)).toBe("薪资待遇");
  expect(metaFrom("普通首行，没有字段标签")).toEqual({
    title: "",
    company: "",
    place: "",
  });
  expect(metaFrom(SAMPLE_JD)).toEqual({
    title: "初级 AI Agent 产品经理",
    company: "星桥科技",
    place: "上海",
  });
});
test("缺任职要求且逗号结尾产生两条警示，并指向原文行", () => {
  const notes = checksOf(sourceLines("岗位职责\n1. 负责需求，"));
  expect(notes).toHaveLength(2);
  expect(notes[1].lineNo).toBe(2);
});
