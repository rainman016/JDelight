// 沿用已确认样机的技能与风险词规则；只做本地点亮，不生成岗位判断。
const SKILL_DEFS: { id: string; label: string; re: RegExp }[] = [
  { id: "llm", label: "大模型原理", re: /大模型|LLM/i },
  { id: "prompt", label: "Prompt Engineering", re: /Prompt/i },
  { id: "rag", label: "RAG", re: /\bRAG\b/i },
  { id: "fc", label: "Function Calling", re: /Function Calling|工具调用/i },
  { id: "sql", label: "SQL", re: /\bSQL\b/i },
  { id: "data", label: "数据分析", re: /数据分析/ },
  { id: "prd", label: "PRD 撰写", re: /\bPRD\b|需求文档/i },
  { id: "xfn", label: "跨部门推进", re: /跨部门|推动.*落地/ },
  { id: "exp", label: "B 端 / AI 产品经验", re: /B 端|AI 产品经验|产品经验/ },
  { id: "agent", label: "Agent 平台", re: /Coze|Dify|Agent 平台/i },
  { id: "py", label: "Python", re: /\bPython\b/i },
  { id: "aigc", label: "AIGC 从 0 到 1", re: /从 ?0 ?到 ?1/ },
];

/** 输入框里的实时点亮：命中技能词与风险词的片段（与解析使用同一组规则）。 */
const RISK_RE = /加班|出差|高强度|996|面议|试用期|初级|实习/;
const LIGHT_RE = new RegExp(
  [...SKILL_DEFS.map((d) => `(?:${d.re.source})`), RISK_RE.source].join("|"),
  "gi",
);
export type Seg = { text: string; kind: "skill" | "risk" | null };
export function lightSegments(raw: string): Seg[] {
  const segs: Seg[] = [];
  let last = 0;
  for (const m of raw.matchAll(LIGHT_RE)) {
    if (m.index === undefined || m[0] === "") continue;
    if (m.index > last)
      segs.push({ text: raw.slice(last, m.index), kind: null });
    segs.push({ text: m[0], kind: RISK_RE.test(m[0]) ? "risk" : "skill" });
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ text: raw.slice(last), kind: null });
  return segs;
}
