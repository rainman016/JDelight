"use client";

import { useEffect, useRef, useState } from "react";
import {
  createAnchor,
  resolveAnchor,
  type TextAnchor,
} from "../../../lib/anchor";
import {
  atomicScenario,
  cascadeScenario,
  isolationScenario,
  upgradeScenario,
} from "../../../lib/spike/database";

const storageKey = "jdelight-spike-anchor";
const highlightKey = "spike-anchor";
interface Painted {
  blockId: string;
  start: number;
  end: number;
  mode: "css" | "mark";
}
const prefix = "虚构报告：";
const first = "数据";
const middle = "😀分析";
const last = "，提供证据。";

function textRange(block: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start >= cursor && start <= cursor + length) {
      range.setStart(node, start - cursor);
      started = true;
    }
    if (started && end <= cursor + length) {
      range.setEnd(node, end - cursor);
      return range;
    }
    cursor += length;
  }
  throw new Error("文字偏移无法转换为 Range");
}

function paint(anchor: TextAnchor): Painted | null {
  const block = document.getElementById(anchor.blockId);
  if (!block) return null;
  const resolved = resolveAnchor(block.textContent ?? "", anchor);
  if (resolved.status === "lost") return null;
  const css =
    new URLSearchParams(location.search).get("highlight") !== "mark" &&
    typeof Highlight !== "undefined" &&
    "highlights" in CSS;
  if (css)
    CSS.highlights.set(
      highlightKey,
      new Highlight(textRange(block, resolved.start, resolved.end)),
    );
  return {
    blockId: anchor.blockId,
    start: resolved.start,
    end: resolved.end,
    mode: css ? "css" : "mark",
  };
}

const cases = {
  atomic: { title: "验证事务回滚", run: atomicScenario },
  cascade: { title: "验证级联删除", run: cascadeScenario },
  upgrade: { title: "验证结构升级", run: upgradeScenario },
  isolation: { title: "验证测试隔离", run: isolationScenario },
};

// 临时技术验证页面：无产品入口，证据提交后删除。
export default function AnchorSpike() {
  const pending = useRef<Range | null>(null);
  const [record, setRecord] = useState<TextAnchor | null>(null);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [status, setStatus] = useState("未保存");
  const [databaseResult, setDatabaseResult] = useState<unknown>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const value = localStorage.getItem(storageKey);
      if (!value) return;
      try {
        const anchor: TextAnchor = JSON.parse(value);
        const restored = paint(anchor);
        setRecord(anchor);
        setPainted(restored);
        setStatus(restored ? "restored" : "lost");
      } catch {
        setStatus("lost");
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (typeof CSS !== "undefined" && "highlights" in CSS)
        CSS.highlights.delete(highlightKey);
    };
  }, []);

  function renderText(text: string, offset: number, blockId: string) {
    if (!painted || painted.mode !== "mark" || painted.blockId !== blockId)
      return text;
    const start = Math.max(0, painted.start - offset);
    const end = Math.min(text.length, painted.end - offset);
    if (start >= end) return text;
    return (
      <>
        {text.slice(0, start)}
        <mark>{text.slice(start, end)}</mark>
        {text.slice(end)}
      </>
    );
  }

  function capture() {
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed)
      pending.current = selection.getRangeAt(0).cloneRange();
  }

  function save() {
    try {
      const range = pending.current;
      if (!range) throw new Error("请先拖选文字");
      const node = range.startContainer;
      const block = (
        node.nodeType === 1 ? (node as Element) : node.parentElement
      )?.closest<HTMLElement>("[data-block-id]");
      if (!block) throw new Error("找不到文字块");
      const anchor = createAnchor(block, range);
      localStorage.setItem(storageKey, JSON.stringify(anchor));
      setRecord(anchor);
      setPainted(paint(anchor));
      setStatus("saved");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <style>
        {
          "::highlight(spike-anchor) { background-color: #c6dfce; color: #1d2420; } mark { background-color: #c6dfce; }"
        }
      </style>
      <h1 className="text-2xl font-bold text-green">
        中文选区与 IndexedDB 技术验证
      </h1>
      <article onMouseUp={capture} className="space-y-4 text-lg leading-loose">
        <p id="report-a" data-block-id="report-a">
          {renderText(prefix, 0, "report-a")}
          <span data-testid="drag-target">
            {renderText(first, prefix.length, "report-a")}
            <strong>
              {renderText(middle, prefix.length + first.length, "report-a")}
            </strong>
            {renderText(
              last,
              prefix.length + first.length + middle.length,
              "report-a",
            )}
          </span>
          {renderText(
            "这是虚构岗位说明。",
            prefix.length + first.length + middle.length + last.length,
            "report-a",
          )}
        </p>
        <p id="report-b" data-block-id="report-b">
          {renderText(
            "团队协作很重要。负责整理虚构案例，团队协作很重要。",
            0,
            "report-b",
          )}
        </p>
        <p id="report-c" data-block-id="report-c">
          {renderText(
            "证据先行：对结果标明出处；观察、推断与待确认分开记录。😀",
            0,
            "report-c",
          )}
        </p>
      </article>
      <button
        className="rounded bg-green px-4 py-2 text-sheet"
        onMouseDown={(event) => event.preventDefault()}
        onClick={save}
      >
        保存锚点
      </button>
      <output data-testid="anchor-status">{status}</output>
      <output data-testid="highlight-mode">{painted?.mode ?? "none"}</output>
      <pre data-testid="anchor-record" className="overflow-auto text-sm">
        {JSON.stringify(record, null, 2)}
      </pre>
      <div className="flex flex-wrap gap-3">
        {Object.entries(cases).map(([key, item]) => (
          <button
            key={key}
            className="rounded bg-mint px-3 py-2"
            onClick={async () => {
              setDatabaseResult(null);
              try {
                setDatabaseResult(await item.run());
              } catch (cause) {
                setDatabaseResult({ error: String(cause) });
              }
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <pre data-testid="db-result" className="overflow-auto text-sm">
        {JSON.stringify(databaseResult, null, 2)}
      </pre>
    </main>
  );
}
