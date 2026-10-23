import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ActiveCitation } from "./report-citations";
interface Thread {
  d: string;
  x: number;
  y: number;
}
export function useCitation() {
  const [active, setActive] = useState<ActiveCitation | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef(new Map<number, HTMLParagraphElement>());
  const registerLine = useCallback(
    (lineNo: number, element: HTMLParagraphElement | null) => {
      if (element) lineRefs.current.set(lineNo, element);
      else lineRefs.current.delete(lineNo);
    },
    [],
  );
  const clear = useCallback(() => {
    setActive(null);
    setThread(null);
    setMobileOpen(false);
  }, []);
  const pick = useCallback((next: ActiveCitation, popup = false) => {
    setActive((previous) => (previous?.id === next.id ? null : next));
    setMobileOpen(innerWidth < 900 || popup);
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const element = lineRefs.current.get(active.citation.lineNo),
      box = scrollRef.current;
    if (element && box) {
      const offset =
        element.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollTo({
        top: Math.max(0, box.scrollTop + offset - box.clientHeight / 3),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
    let frame = 0;
    const measure = () => {
      if (innerWidth < 900 || !element || !box || !active.element.isConnected) {
        setThread(null);
        return;
      }
      const target = element.getBoundingClientRect(),
        from = active.element.getBoundingClientRect(),
        clip = box.getBoundingClientRect();
      const x1 = from.left,
        y1 = from.top + from.height / 2,
        x2 = target.right + 2,
        y2 = target.top + target.height / 2;
      if (y2 < clip.top || y2 > clip.bottom || y1 < 52 || y1 > innerHeight) {
        setThread(null);
        return;
      }
      const middle = (x1 + x2) / 2;
      setThread({
        d: `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`,
        x: x2,
        y: y2,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (box) observer.observe(box);
    observer.observe(active.element);
    document.fonts.addEventListener("loadingdone", schedule);
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", schedule);
      removeEventListener("scroll", schedule, true);
      removeEventListener("resize", schedule);
    };
  }, [active]);
  return {
    active,
    thread: active ? thread : null,
    mobileOpen,
    setMobileOpen,
    clear,
    pick,
    scrollRef,
    registerLine,
  };
}
