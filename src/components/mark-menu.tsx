"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MARKS, type Mark } from "@/domain/schema";
import { Chevron } from "./chevron";
export function MarkMenu({
  mark,
  onChange,
}: {
  mark: Mark;
  onChange: (mark: Mark) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      className="stamp-wrap"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
        const buttons = [
          ...(root.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ) ?? []),
        ];
        if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const i = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                  buttons.length
          ]?.focus();
        }
        if (e.key === "Tab") setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="stamp"
        data-mark={MARKS[mark]}
        aria-label={`我的标记：${MARKS[mark]}`}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {MARKS[mark]} <Chevron />
      </button>
      {open && (
        <ul id={id} className="menu" role="menu" aria-label="我的标记">
          {(Object.keys(MARKS) as Mark[]).map((value) => (
            <li role="none" key={value}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={mark === value}
                disabled={busy}
                onClick={async (e) => {
                  e.stopPropagation();
                  setBusy(true);
                  try {
                    await onChange(value);
                  } finally {
                    setBusy(false);
                    setOpen(false);
                    trigger.current?.focus();
                  }
                }}
              >
                {MARKS[value]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
