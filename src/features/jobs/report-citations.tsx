import { createContext, useContext, useId, type ReactNode } from "react";
import type { Citation, Claim } from "@/domain/report";
import type { SourceVersion } from "@/domain/schema";
import { citationLabel } from "@/domain/source";
import { KIND_LABEL } from "@/domain/report-presentation";

export interface ActiveCitation {
  id: string;
  citation: Citation;
  label: string;
  element: HTMLButtonElement;
}
const Context = createContext<{
  source: SourceVersion;
  activeId?: string;
  onPick?: (active: ActiveCitation) => void;
} | null>(null);
export function CitationProvider({
  source,
  activeId,
  onPick,
  children,
}: {
  source: SourceVersion;
  activeId?: string;
  onPick?: (active: ActiveCitation) => void;
  children: ReactNode;
}) {
  return (
    <Context.Provider value={{ source, activeId, onPick }}>
      {children}
    </Context.Provider>
  );
}
export function KindTag({ kind }: { kind: Claim["kind"] }) {
  return kind === "source" ? null : (
    <span className={`kind kind-${kind}`} data-anchor-ignore="">
      {KIND_LABEL[kind]}
    </span>
  );
}
export function Citations({ items }: { items: Citation[] }) {
  const context = useContext(Context);
  const owner = useId();
  if (!context) throw new Error("出处缺少原文上下文");
  return (
    <span className="jd-cites" data-anchor-ignore="">
      {items.map((citation, index) => {
        const line = context.source.lines.find(
          (item) => item.lineNo === citation.lineNo,
        );
        const label = line
          ? citationLabel(line)
          : `原文第 ${citation.lineNo} 行`;
        const id = `${owner}-${index}`;
        return context.onPick ? (
          <button
            type="button"
            key={id}
            className="cite"
            aria-pressed={context.activeId === id}
            title={`查看依据：${citation.quote}`}
            onClick={(event) =>
              context.onPick?.({
                id,
                citation,
                label,
                element: event.currentTarget,
              })
            }
          >
            {label}
          </button>
        ) : (
          <span key={id} className="jd-print-citation">
            〔{label}：{citation.quote}〕
          </span>
        );
      })}
    </span>
  );
}
export function ClaimText({ item }: { item: Claim }) {
  return (
    <>
      <KindTag kind={item.kind} />
      {item.text}
      <Citations items={item.citations} />
    </>
  );
}
