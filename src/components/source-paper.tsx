import type { SourceLine } from "@/domain/source";
import { SECTION_LABEL } from "@/domain/source";
export function SourcePaper({
  lines,
  flagged = [],
  label = "原文",
}: {
  lines: SourceLine[];
  flagged?: number[];
  label?: string;
}) {
  return (
    <div className="paper cf-paper">
      <div className="win-bar">
        <span className="win-title">
          {label} · {lines.length} 行
        </span>
      </div>
      <div className="paper-lines">
        {lines.map((l) => (
          <p
            key={l.lineNo}
            className="pl cf-line"
            data-heading={l.heading}
            data-flag={flagged.includes(l.lineNo)}
          >
            <span className="pl-tag">
              {l.heading
                ? l.section === "bonus"
                  ? "加分"
                  : SECTION_LABEL[l.section]
                : ""}
            </span>
            <span className="cf-no" aria-label={`第 ${l.lineNo} 行`}>
              {l.lineNo}
            </span>
            <span className="pl-text">{l.text || "\u00a0"}</span>
          </p>
        ))}
      </div>
    </div>
  );
}
