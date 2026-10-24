import { expect, test } from "vitest";
import { citationLabel, sourceLines } from "./source";
import sample from "../../fixtures/sample-jd.json";

test.each([
  ["职位描述", "duty"],
  ["岗位描述", "duty"],
  ["职责描述", "duty"],
  ["你要做的", "duty"],
  ["职责要求", "must"],
  ["任职条件", "must"],
  ["基本要求", "must"],
  ["你需要具备", "must"],
  ["核心能力", "must"],
  ["优先考虑", "bonus"],
  ["加分", "bonus"],
  ["Nice to Have", "bonus"],
  ["【加分项 - Nice to Have】", "bonus"],
  ["【核心能力 - Must Have】", "must"],
  ["  1. [ 任职条件 ] ： ", "must"],
  ["（二） ( 职责描述 )：", "duty"],
  ["三、【 核心 能力 - Must Have 】", "must"],
  ["[2] 【加分项 - Nice to Have】", "bonus"],
  ["4 岗位描述", "duty"],
  ["任职要求及说明", "must"],
])("标题 %s 规范化后归入 %s，原文字面不变", (heading, section) => {
  const text = `岗位职责\n负责虚构产品调研\n${heading}\n具备虚构产品经验`;
  const lines = sourceLines(text);
  expect(lines[2]).toMatchObject({ text: heading, heading: true, section });
  expect(lines[3]).toMatchObject({ heading: false, section });
  expect(lines.map((line) => line.text).join("\n")).toBe(text);
  if (section === "must") expect(citationLabel(lines[3])).toBe("要求第 1 条");
});

test("正文长句含职责或要求关键词不误判，标题上限为规范化后 24 字", () => {
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
  expect(sourceLines(`核心能力${"甲".repeat(20)}`)[0].heading).toBe(true);
  expect(sourceLines(`核心能力${"甲".repeat(21)}`)[0].heading).toBe(false);
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
