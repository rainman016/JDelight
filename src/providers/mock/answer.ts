export type AnswerProvider = (
  question: string,
  selected: string,
) => Promise<{ answer: string; answerKind: "common" }>;
export const mockAnswer: AnswerProvider = async () => ({
  answer:
    "示例解答：可以先用自己的话解释所选内容，再举一个课程或个人项目中的例子。这是通用的理解方法，不新增招聘方信息，也不改变原文的要求程度。",
  answerKind: "common",
});
