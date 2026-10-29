import { expect, test } from "vitest";
import { checksOf, citationLabel, metaFrom, sourceLines } from "./source";
import sample from "../../fixtures/sample-jd.json";

test.each([
  ["职位描述", "duty"],
  ["岗位描述", "duty"],
  ["职责描述", "duty"],
  ["你要做的", "duty"],
  ["职责要求", "must"],
  ["职责要求：", "must"],
  ["任职要求", "must"],
  ["任职条件", "must"],
  ["基本要求", "must"],
  ["你需要具备", "must"],
  ["核心能力", "must"],
  ["优先考虑", "bonus"],
  ["加分", "bonus"],
  ["Nice to Have", "bonus"],
  [" nice TO Have ", "bonus"],
  ["【加分项 - Nice to Have】", "bonus"],
  ["【核心能力 - Must Have】", "must"],
  ["  1. [ 任职条件 ] ： ", "must"],
  ["（二） ( 职责描述 )：", "duty"],
  ["三、【 核心 能力 - Must Have 】", "must"],
  ["[2] 【加分项 - Nice to Have】", "bonus"],
  ["4 岗位描述", "duty"],
])("标题 %s 规范化后归入 %s，原文字面不变", (heading, section) => {
  const text = `岗位职责\n负责虚构产品调研\n${heading}\n具备虚构产品经验`;
  const lines = sourceLines(text);
  expect(lines[2]).toMatchObject({ text: heading, heading: true, section });
  expect(lines[3]).toMatchObject({ heading: false, section });
  expect(lines.map((line) => line.text).join("\n")).toBe(text);
  if (section === "must") expect(citationLabel(lines[3])).toBe("要求第 1 条");
});

test.each([
  "1. 基本要求：本科及以上学历",
  "加分：有 Python 经验",
  "岗位职责（深圳）",
  "任职要求及说明",
])("正文 %s 不等于词表项，保留要求条目编号和原文", (text) => {
  const lines = sourceLines(`任职要求\n${text}\n能够清楚表达虚构产品需求`);
  expect(lines[1]).toMatchObject({
    text,
    heading: false,
    section: "must",
    itemNo: 1,
  });
  expect(citationLabel(lines[1])).toBe("要求第 1 条");
  expect(lines[2]).toMatchObject({
    heading: false,
    section: "must",
    itemNo: 2,
  });
});

test("正文长句含职责或要求关键词不误判", () => {
  const long =
    "岗位职责包括整理虚构产品访谈结果并与团队讨论需求以及持续跟进用户反馈和迭代效果";
  const lines = sourceLines(
    `任职要求\n${long}\n团队希望了解你的职责要求和沟通方式`,
  );
  expect(lines[1]).toMatchObject({
    heading: false,
    section: "must",
    itemNo: 1,
  });
  expect(lines[2]).toMatchObject({
    heading: false,
    section: "must",
    itemNo: 2,
  });
});

test("示例 JD 的标题、分区与条目编号保持原结果", () => {
  const lines = sourceLines(sample);
  expect(
    lines.filter((line) => line.heading).map((line) => line.lineNo),
  ).toEqual([4, 11, 18]);
  expect(lines.map((line) => line.section)).toEqual([
    "meta",
    "meta",
    "other",
    "duty",
    "duty",
    "duty",
    "duty",
    "duty",
    "duty",
    "other",
    "must",
    "must",
    "must",
    "must",
    "must",
    "must",
    "other",
    "bonus",
    "bonus",
    "bonus",
    "bonus",
    "other",
    "bonus",
  ]);
  expect(
    lines.filter((line) => line.itemNo !== null).map((line) => line.itemNo),
  ).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4]);
});

const completeSource = [
  "岗位名称：虚构产品专员",
  "公司：测试纸舟科技",
  "岗位职责",
  "负责整理虚构产品需求。",
  "任职要求",
  "能够清晰表达需求。",
];

test.each([
  [0, "岗位名称：虚构产品…方向专员"],
  [0, "岗位名称：虚构产品...方向专员"],
  [0, "岗位名称：虚构产品专员…"],
  [1, "公司：测试纸舟...科技"],
  [1, "公司：测试纸舟科技……"],
  [3, "负责整理 …… 并跟进虚构需求。"],
  [5, "能够清晰表达...虚构需求。"],
])("第 %s 行省略号提示且不声称原文完整", (index, text) => {
  const raw = [...completeSource];
  raw[index] = text;
  const notes = checksOf(sourceLines(raw.join("\n")), metaFrom(raw.join("\n")));
  expect(notes).toContainEqual({
    level: "warn",
    text: `第 ${index + 1} 行有省略号，原文可能不完整；分析不会补全。`,
    lineNo: index + 1,
  });
  expect(notes.some((note) => note.level === "ok")).toBe(false);
  expect(notes.filter((note) => note.text.includes("有省略号"))).toHaveLength(
    1,
  );
});

test.each(["……", "...", "，", "、", "和", "及"])(
  "末尾 %s 保留原有截断提示，不重复当作中间省略号",
  (ending) => {
    const raw = [...completeSource];
    raw[5] = `能够清晰表达${ending}`;
    expect(checksOf(sourceLines(raw.join("\n")))).toEqual([
      {
        level: "warn",
        text: "第 6 行像是没写完，可能复制时被截断。",
        lineNo: 6,
      },
    ]);
  },
);

test("手改字段有省略号时提示字段，不借用原文行号", () => {
  const notes = checksOf(sourceLines(completeSource.join("\n")), {
    title: "虚构产品…专员",
    company: "测试纸舟科技...",
    place: "测试地点",
  });
  expect(notes).toEqual([
    {
      level: "warn",
      text: "岗位名称有省略号，原文可能不完整；分析不会补全。",
    },
    {
      level: "warn",
      text: "公司有省略号，原文可能不完整；分析不会补全。",
    },
  ]);
});

test("完整原文仍显示分区齐全，不把小数点或一个点当省略号", () => {
  const raw = [...completeSource];
  raw[3] = "1. 负责整理虚构产品 2.0 需求。";
  expect(checksOf(sourceLines(raw.join("\n")))).toEqual([
    { level: "ok", text: "分区齐全，没发现被截断的迹象。" },
  ]);
});
