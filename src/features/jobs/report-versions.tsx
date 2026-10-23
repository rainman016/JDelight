import { useEffect, useRef, useState } from "react";
import type { ReportVersion } from "@/domain/schema";
import { reportDate } from "@/domain/report-presentation";
export function ReportVersions({
  versions,
  currentId,
  selected,
  onSelect,
}: {
  versions: ReportVersion[];
  currentId: string;
  selected: ReportVersion;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open)
      wrap.current
        ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
        ?.focus();
  }, [open]);
  return (
    <div
      className="jd-version-wrap"
      ref={wrap}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (
          !open ||
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        )
          return;
        event.preventDefault();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="jd-version-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>
          报告第 {selected.no} 版 ·{" "}
          {selected.content.origin === "model" ? "真实分析" : "示例分析"}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="jd-version-menu" role="menu" aria-label="报告版本">
          {[...versions].reverse().map((version) => (
            <li role="none" key={version.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={version.id === selected.id}
                onClick={() => {
                  onSelect(version.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <strong>
                  第 {version.no} 版{version.id === currentId ? "（当前）" : ""}
                </strong>
                <span>
                  {version.change.summary} · {reportDate(version.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
