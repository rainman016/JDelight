import type { Citation } from "./report";
import type { SourceVersion } from "./schema";

// V8–V10 的词表与表达式集中维护；只做可解释的文字检查，不猜测语义。
export const CONDITION_WORDS = [
  "博士研究生",
  "硕士研究生",
  "研究生",
  "博士",
  "硕士",
  "本科",
  "大专",
  "专科",
  "中专",
  "高中",
  "初中",
  "非应届毕业生",
  "应届毕业生",
  "非应届生",
  "非在校生",
  "在校大学生",
  "在校生",
  "应届生",
  "毕业生",
  "实习生",
] as const;
export const CONDITION_PREFIXES = [
  "不少于",
  "不低于",
  "不多于",
  "不高于",
  "不超过",
  "至少",
  "最少",
  "最低",
  "至多",
  "最多",
  "最高",
  "超过",
  "少于",
  "大于",
  "小于",
  "不满",
  "大约",
  "约",
  "近",
  "满",
  "仅限",
  "只限",
  "不限",
  "限",
  "仅",
  "非",
] as const;
export const CONDITION_QUALIFIERS = [
  "及以上",
  "及以下",
  "以上",
  "以下",
  "以内",
  "以外",
  "起步",
  "左右",
  "起",
] as const;
export const CONDITION_UNITS = [
  "个月",
  "小时",
  "分钟",
  "万元",
  "年",
  "月",
  "周",
  "天",
  "日",
  "岁",
  "元",
  "万",
  "千",
  "K",
  "k",
  "人",
  "个",
  "项",
  "次",
  "名",
  "%",
  "％",
] as const;
export const CONDITION_PERIODS = [
  "小时",
  "年",
  "月",
  "周",
  "天",
  "日",
] as const;
export const NUMBER_PATTERN = String.raw`(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)`;
const prefix = `(?:(?:${CONDITION_PREFIXES.join("|")})\\s*)?`;
const qualifier = `(?:\\s*(?:${CONDITION_QUALIFIERS.join("|")}))?`;
export const NUMERIC_CONDITION_PATTERN =
  String.raw`(?<![\d.零〇一二两三四五六七八九十百千万])` +
  prefix +
  String.raw`(?:[¥￥$]\s*)?` +
  NUMBER_PATTERN +
  String.raw`(?:\s*[-–—~～至到]\s*` +
  NUMBER_PATTERN +
  String.raw`)?\s*` +
  `(?:${CONDITION_UNITS.join("|")})` +
  `(?:\\s*(?:/|／|每)\\s*(?:${CONDITION_PERIODS.join("|")}))?` +
  qualifier;
export const WORD_CONDITION_PATTERN =
  prefix + `(?:${CONDITION_WORDS.join("|")})` + qualifier;
export const CONDITION_LEFT_BOUNDARY_PATTERN =
  /[\d.零〇一二两三四五六七八九十百千万非\-–—~～至到]$/u;
export const REPLACEMENT_PATTERN =
  /替代|代替|顶替|等同于|视同|抵(?!达|触|抗|御|制|赖|押|挡)/u;
export const CONFIRMATION_PATTERN =
  /(?:向|与)(?:招聘方|用人方|用人单位|招聘人员|招聘负责人|面试官|HR)确认|是否(?:被)?(?:认可|接受|允许)|(?:需|须|有待|需要|必须)(?:进一步)?确认|以(?:招聘方|用人方|用人单位)(?:的)?确认为准/giu;
export const NEGATED_CONFIRMATION_PATTERN =
  /(?:无需|无须|不必|不用|不需要|不要|无|不)\s*(?:(?:再|另行|进一步)\s*)?(?:(?:(?:向|与)(?:招聘方|用人方|用人单位|招聘人员|招聘负责人|面试官|HR))?确认\s*)?$/iu;
export const HEADER_IGNORED_PATTERN = /[\s\p{P}]/gu;

export function conditionFragments(text: string): string[] {
  return [
    ...new Set(
      [NUMERIC_CONDITION_PATTERN, WORD_CONDITION_PATTERN].flatMap((pattern) =>
        [...text.matchAll(new RegExp(pattern, "gu"))].map((match) => match[0]),
      ),
    ),
  ];
}

export function unsupportedConditions(
  text: string,
  refs: Citation[],
): string[] {
  // 空引用交给 V3；不同引用不拼接，也不允许从“13个月”截取“3个月”。
  if (!refs.length) return [];
  return conditionFragments(text).filter(
    (fragment) =>
      !refs.some(({ quote }) => {
        let start = quote.indexOf(fragment);
        while (start !== -1) {
          if (!CONDITION_LEFT_BOUNDARY_PATTERN.test(quote.slice(0, start)))
            return true;
          start = quote.indexOf(fragment, start + 1);
        }
        return false;
      }),
  );
}

export function hasUnconfirmedReplacement(text: string): boolean {
  if (!REPLACEMENT_PATTERN.test(text)) return false;
  return ![...text.matchAll(CONFIRMATION_PATTERN)].some(
    (match) => !NEGATED_CONFIRMATION_PATTERN.test(text.slice(0, match.index)),
  );
}

export function headerFollowsSource(
  text: string,
  refs: Citation[],
  lines: SourceVersion["lines"],
): boolean {
  if (!refs.length) return true; // V3 单独报告缺少引用。
  // 按原文行号、行内位置合并引用范围，不能靠倒排或重复引用增加字符。
  const quoted = [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((line) => {
      const ranges = refs
        .filter((ref) => ref.lineNo === line.lineNo)
        .flatMap((ref) => {
          if (!ref.quote.length) return [];
          const matches: { start: number; end: number }[] = [];
          let start = line.text.indexOf(ref.quote);
          while (start !== -1) {
            matches.push({ start, end: start + ref.quote.length });
            start = line.text.indexOf(ref.quote, start + 1);
          }
          return matches;
        })
        .sort((a, b) => a.start - b.start);
      let end = 0;
      return ranges
        .map((range) => {
          const fragment = line.text.slice(
            Math.max(end, range.start),
            Math.max(end, range.end),
          );
          end = Math.max(end, range.end);
          return fragment;
        })
        .join("");
    })
    .join("")
    .replace(HEADER_IGNORED_PATTERN, "");
  const expected = [...text.replace(HEADER_IGNORED_PATTERN, "")];
  let cursor = 0;
  for (const character of quoted) {
    if (character === expected[cursor]) cursor++;
  }
  return cursor === expected.length;
}
