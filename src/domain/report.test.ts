import { expect, test } from "vitest";
import { sourceLines, metaFrom, checksOf, citationLabel } from "./source";
import { ReportCheckError, validateReport } from "./report";
import { reportFor, SAMPLE_JD } from "../providers/mock";
import type { SourceVersion } from "./schema";
import invalidV2 from "../../fixtures/invalid-v2.json";
import invalidV4 from "../../fixtures/invalid-v4.json";
import invalidV5 from "../../fixtures/invalid-v5.json";
import invalidV6 from "../../fixtures/invalid-v6.json";
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
