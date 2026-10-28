import { expect, test } from "vitest";
import { reportFor } from "../providers/mock";
import { sourceLines } from "./source";
import {
  ReportCheckError,
  validateReport,
  type Claim,
  type ReportContent,
} from "./report";
import type { SourceVersion } from "./schema";

function fixture(condition = "5天/周 3个月 本科") {
  const text = `岗位名称：虚构AI产品经理…gent方向)\n公司：虚构星港科技有限…\n薪资待遇：450-650元/天\n${condition}\n岗位职责\n1. 负责产品原型设计。\n任职要求\n1. 2年以上产品经验，具备完整交付经验。`;
  const source: SourceVersion = {
    id: "fidelity-source",
    jobId: "fidelity-job",
    no: 1,
    text,
    lines: sourceLines(text),
    confirmedAt: "2026-10-28T00:00:00.000Z",
  };
  const report = reportFor(source);
  const claim: Claim = {
    id: "fidelity-claim",
    text: condition,
    kind: "source",
    citations: [{ lineNo: 4, quote: condition }],
  };
  report.sections[0].blocks = [
    { type: "paragraph", blockId: "fidelity-paragraph", claims: [claim] },
  ];
  return { source, report, claim };
}
function codes(report: ReportContent, source: SourceVersion) {
  try {
    validateReport(report, source);
    return [];
  } catch (error) {
    if (!(error instanceof ReportCheckError)) throw error;
    return error.issues.map((issue) => issue.code);
  }
}

test.each([
  ["3个月", "3个月起"],
  ["3个月", "至少3个月"],
  ["3个月", "4个月"],
  ["三个月", "三个月起"],
  ["13个月", "3个月"],
  ["450-650元/天", "450-650元/月"],
  ["本科", "面向本科在校生"],
  ["本科", "硕士"],
  ["本科及以上", "本科以下"],
  ["非应届生", "应届生"],
])("V8：原文 %s 不能被 source 论断改为 %s", (original, rewritten) => {
  const { report, source, claim } = fixture(original);
  claim.text = rewritten;
  expect(codes(report, source)).toContain("V8");
});

test.each([
  "5天/周 3个月 本科",
  "450-650元/天",
  "至少2 年以上",
  "三个月",
  "应届毕业生",
  "本科及以上",
])("V8：原样条件 %s 及对应页头通过", (condition) => {
  const { report, source, claim } = fixture(condition);
  report.header.shown.push({
    id: "fidelity-condition",
    text: condition,
    citations: claim.citations,
  });
  expect(() => validateReport(report, source)).not.toThrow();
});

test("V8：按每条引用的完整条件匹配，不借用同一行未引用内容或拼接引用", () => {
  const { report, source, claim } = fixture("3个月 本科");
  claim.citations = [{ lineNo: 4, quote: "本科" }];
  expect(codes(report, source)).toContain("V8");
  claim.text = "3个月";
  claim.citations = [
    { lineNo: 4, quote: "3个" },
    { lineNo: 4, quote: "月" },
  ];
  expect(codes(report, source)).toContain("V8");
});

test("V8：header.shown 也校验；推断学生身份不作为原文事实拒绝", () => {
  const { report, source, claim } = fixture("本科");
  claim.text = "推断这类实习可能面向本科在校生，仍需向招聘方确认。";
  claim.kind = "inference";
  expect(() => validateReport(report, source)).not.toThrow();
  report.header.shown.push({
    id: "invented-condition",
    text: "本科在校生",
    citations: claim.citations,
  });
  expect(codes(report, source)).toContain("V8");
});

test("V8：片段逐字存在即可，不要求等于引用中的最大条件片段", () => {
  const { report, source, claim } = fixture("5天/周 本科及以上");
  claim.text = "每周5天，本科。";
  expect(() => validateReport(report, source)).not.toThrow();
});

test("空引用仍由 V3 处理，不重复报告 V8 / V9", () => {
  const { report, source, claim } = fixture();
  claim.citations = [];
  report.header.shown = [
    { id: "no-citation", text: "本科在校生", citations: [] },
  ];
  const result = codes(report, source);
  expect(result).toContain("V3");
  expect(result).not.toContain("V8");
  expect(result).not.toContain("V9");
});

test.each([
  [1, "岗位名称：虚构AI产品经理（Agent方向）"],
  [2, "公司：虚构星港科技有限公司"],
  [1, "产品经理虚构AIgent方向"],
])("V9：第 %s 行不能补字或重排成 %s", (lineNo, text) => {
  const { report, source } = fixture();
  report.header.shown = [
    {
      id: "rewritten-header",
      text,
      citations: [{ lineNo, quote: source.lines[lineNo - 1].text }],
    },
  ];
  expect(codes(report, source)).toContain("V9");
});

test("V9：允许去标点、空白及按原顺序省略；所有页头条件都受约束", () => {
  const { report, source } = fixture();
  report.header.shown = [
    {
      id: "header",
      text: "虚构 AI 产品经理 gent 方向",
      citations: [{ lineNo: 1, quote: source.lines[0].text }],
    },
  ];
  expect(() => validateReport(report, source)).not.toThrow();
  report.header.shown = [
    {
      id: "header",
      text: "薪资面议",
      citations: [{ lineNo: 3, quote: source.lines[2].text }],
    },
  ];
  expect(codes(report, source)).toContain("V9");
});

test("V9：不能靠倒排引用或重复同一引用获得新增字符", () => {
  const { report, source } = fixture();
  report.header.shown = [
    {
      id: "header",
      text: "星港虚构",
      citations: [
        { lineNo: 2, quote: "星港" },
        { lineNo: 2, quote: "虚构" },
      ],
    },
  ];
  expect(codes(report, source)).toContain("V9");
  report.header.shown[0].text = "星港星港";
  report.header.shown[0].citations = [
    { lineNo: 2, quote: "星港" },
    { lineNo: 2, quote: "星港" },
  ];
  expect(codes(report, source)).toContain("V9");
});

test("V9：同一行重复词的引用应考虑其他真实出现位置", () => {
  const { report, source } = fixture("产品经验优先，需熟悉产品");
  report.header.shown = [
    {
      id: "repeated-word-header",
      text: "熟悉产品",
      citations: [
        { lineNo: 4, quote: "熟悉" },
        { lineNo: 4, quote: "产品" },
      ],
    },
  ];
  expect(() => validateReport(report, source)).not.toThrow();
});

test.each(["替代", "代替", "顶替", "抵", "抵扣", "等同于", "视同"])(
  "V10：无确认语的 %s 岗位要求建议被拒",
  (word) => {
    const { report, source, claim } = fixture();
    claim.kind = "common";
    claim.text = `可用课程项目${word}完整交付经验。`;
    expect(codes(report, source)).toContain("V10");
  },
);
test.each([
  "可以用课程项目证明相关能力。",
  "课程项目能否替代经验、是否认可需向招聘方确认。",
  "课程项目能否替代经验，以招聘方确认为准。",
  "通常应提前抵达面试地点，不抵触合理反馈。",
])("V10：合理建议通过：%s", (text) => {
  const { report, source, claim } = fixture();
  Object.assign(claim, { kind: "common", text });
  expect(() => validateReport(report, source)).not.toThrow();
});
test.each([
  "无需向招聘方确认",
  "无须确认",
  "不需要确认",
  "无需确认是否认可",
  "不用再向招聘方确认",
  "不必向招聘方确认是否认可",
  "不需要再确认是否被认可",
])("V10：否定确认语 %s 不放行", (confirmation) => {
  const { report, source, claim } = fixture();
  Object.assign(claim, {
    kind: "common",
    text: `课程项目可替代经验，${confirmation}。`,
  });
  expect(codes(report, source)).toContain("V10");
});
test("V10：另一论断的确认语不能为替代结论兜底", () => {
  const { report, source, claim } = fixture();
  Object.assign(claim, { kind: "common", text: "可用课程项目替代经验。" });
  const block = report.sections[0].blocks[0];
  if (block.type !== "paragraph") throw new Error("fixture");
  block.claims.push({
    ...claim,
    id: "confirmation-elsewhere",
    text: "具体岗位要求需向招聘方确认。",
  });
  expect(codes(report, source)).toContain("V10");
});

test.each([
  "gist",
  "focus",
  "basis",
  "requirement",
  "capability",
  "product",
  "difficulty",
  "probe",
])("V10：覆盖 %s 中的论断", (location) => {
  const { report, source, claim } = fixture();
  const text = "可用课程项目替代完整交付经验。";
  const bad = { ...claim, id: "bad-claim", text, kind: "common" as const };
  switch (location) {
    case "gist":
      report.focus.gist.text = text;
      break;
    case "focus":
      report.focus.items[0].text = text;
      break;
    case "basis":
      report.focus.items[0].basis = text;
      break;
    case "requirement":
      report.sections[1].blocks = [
        {
          blockId: "bad-requirement",
          type: "requirement",
          phrase: "具备完整交付经验",
          strength: "required",
          degree: "",
          citations: [{ lineNo: 8, quote: "具备完整交付经验" }],
          note: bad,
        },
      ];
      break;
    case "capability":
      report.sections[3].blocks = [
        {
          blockId: "bad-capability",
          type: "capability",
          name: "交付能力",
          importance: "high",
          meaning: [bad],
        },
      ];
      break;
    case "product":
    case "difficulty":
      report.sections[4].blocks = [
        {
          blockId: "bad-scenario",
          type: "scenario",
          scene: "虚构场景",
          product: location === "product" ? bad : { ...claim, id: "product" },
          difficulty:
            location === "difficulty" ? bad : { ...claim, id: "difficulty" },
        },
      ];
      break;
    case "probe":
      report.sections[5].blocks = [
        {
          blockId: "bad-probe",
          type: "probe",
          claim: { ...bad, kind: "speculation" },
        },
      ];
      break;
  }
  expect(codes(report, source)).toContain("V10");
});
