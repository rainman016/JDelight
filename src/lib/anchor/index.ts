export interface TextAnchor {
  blockId: string;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export type AnchorResolution =
  | { start: number; end: number; status: "exact" | "relocated" }
  | { start: null; end: null; status: "lost" };

const contextLength = 32;

function boundaries(text: string): Set<number> {
  const offsets = new Set<number>([0, text.length]);
  const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
  for (const { index } of segmenter.segment(text)) offsets.add(index);
  return offsets;
}

function owningBlock(node: Node): Element | null {
  return (
    (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(
      "[data-block-id]",
    ) ?? null
  );
}

/** 不改动原 DOM；忽略显式标记的界面文字，正文空白和原词保持不变。 */
export function getAnchorText(root: Element | DocumentFragment): string {
  const copy = root.cloneNode(true) as Element | DocumentFragment;
  copy
    .querySelectorAll("[data-anchor-ignore]")
    .forEach((node) => node.remove());
  return copy.textContent ?? "";
}

/**
 * 文本契约：块以 data-block-id 标识，data-anchor-ignore 标记界面文字。
 * 创建、偏移与恢复使用同一正文投影，不折叠空白、不插入虚拟换行。
 * start/end 是 UTF-16 半开区间；选择边界向外对齐完整字素，避免拆开 emoji。
 * prefix/suffix 各取最多 32 个 Unicode 码点，保持代理对完整。
 */
export function createAnchor(
  blockElement: HTMLElement,
  range: Range,
): TextAnchor {
  const blockId = blockElement.dataset.blockId;
  if (!blockId) throw new Error("文字块缺少稳定的 data-block-id");
  if (
    owningBlock(range.startContainer) !== blockElement ||
    owningBlock(range.endContainer) !== blockElement
  ) {
    throw new Error("不支持跨块选择，请缩小选择范围");
  }
  if (range.collapsed) throw new Error("请选择非空文字");

  const text = getAnchorText(blockElement);
  const offset = (node: Node, index: number) => {
    const prefix = blockElement.ownerDocument.createRange();
    prefix.selectNodeContents(blockElement);
    prefix.setEnd(node, index);
    return getAnchorText(prefix.cloneContents()).length;
  };
  let start = offset(range.startContainer, range.startOffset);
  let end = offset(range.endContainer, range.endOffset);
  const safe = boundaries(text);
  while (start > 0 && !safe.has(start)) start--;
  while (end < text.length && !safe.has(end)) end++;
  if (start === end) throw new Error("请选择非空文字");

  return {
    blockId,
    start,
    end,
    exact: text.slice(start, end),
    prefix: Array.from(text.slice(0, start)).slice(-contextLength).join(""),
    suffix: Array.from(text.slice(end)).slice(0, contextLength).join(""),
  };
}

/** 只在调用方已确认的同一文字块内解析；不推断报告版本或跨块身份。 */
export function resolveAnchor(
  text: string,
  anchor: TextAnchor,
): AnchorResolution {
  const lost = { start: null, end: null, status: "lost" } as const;
  if (
    !anchor.exact ||
    !Number.isInteger(anchor.start) ||
    !Number.isInteger(anchor.end) ||
    anchor.start < 0 ||
    anchor.end <= anchor.start ||
    anchor.end - anchor.start !== anchor.exact.length
  )
    return lost;

  const safe = boundaries(text);
  const valid = (start: number, end: number) =>
    safe.has(start) && safe.has(end);
  if (
    valid(anchor.start, anchor.end) &&
    text.slice(anchor.start, anchor.end) === anchor.exact
  )
    return { start: anchor.start, end: anchor.end, status: "exact" };

  const matches: { start: number; end: number; score: number }[] = [];
  for (
    let start = text.indexOf(anchor.exact);
    start !== -1;
    start = text.indexOf(anchor.exact, start + 1)
  ) {
    const end = start + anchor.exact.length;
    if (!valid(start, end)) continue;
    const prefixMatches =
      !!anchor.prefix && text.slice(0, start).endsWith(anchor.prefix);
    const suffixMatches =
      !!anchor.suffix && text.slice(end).startsWith(anchor.suffix);
    matches.push({
      start,
      end,
      score: Number(prefixMatches) + Number(suffixMatches),
    });
  }
  if (matches.length === 0) return lost;
  if (matches.length === 1) {
    return {
      start: matches[0].start,
      end: matches[0].end,
      status: "relocated",
    };
  }
  const bestScore = Math.max(...matches.map(({ score }) => score));
  const best = matches.filter(({ score }) => score === bestScore);
  // 重句须有完整的前文或后文支持，且最高支持只对应一个位置；不靠距离猜。
  if (bestScore === 0 || best.length !== 1) return lost;
  return { start: best[0].start, end: best[0].end, status: "relocated" };
}
