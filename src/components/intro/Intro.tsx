"use client";
import "@/styles/intro.css";
import { Fragment, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { IntroController } from "./Intro3D";

/**
 * 开场（CSS 3D 版，拼贴 + 柔软气质）分镜：
 * 歪着的窗口落地（地面涟漪）→ 果冻式晃动 → 扫描：马克笔高亮、波浪下划线，
 * 解析结果像显影的照片被抛在地上 → 识别出的词飞出，在窗口周围的 3D 轨道环绕
 * → 角落贴上便利贴 → 悬停时轨道暂停。
 * 点击：窗口按重力坠落、撞击压扁，同时崩出一把字；窗口与字各自弹跳几次，纸色从撞击点扩张，进入输入页。
 * 默认动态加载 WebGL 几何与物理；DOM 保留原生清晰文字，CSS 分镜作为回退。
 */
const SCAN_START = 1.6;
const SCAN_TIME = 1.8;
type Part = string | { t: string; kind: "skill" | "risk"; chip: number };
const LINES: Part[][] = [
  ["岗位职责"],
  [
    "1. 负责客服场景的 AI Agent 产品设计，输出",
    { t: "需求文档", kind: "skill", chip: 0 },
    "。",
  ],
  [
    "2. 梳理 ",
    { t: "Prompt", kind: "skill", chip: 1 },
    "、",
    { t: "工具调用", kind: "skill", chip: 2 },
    "与工作流。",
  ],
  [
    "3. 使用 ",
    { t: "SQL", kind: "skill", chip: 3 },
    " 分析用户行为，制定迭代计划。",
  ],
  ["任职要求"],
  [
    "1. 2 年以上产品经验，熟悉 ",
    { t: "RAG", kind: "skill", chip: 4 },
    " 等技术。",
  ],
  ["2. 适应较快节奏，配合", { t: "加班", kind: "risk", chip: 6 }, "和出差。"],
  ["加分项"],
  [
    "1. 熟悉 ",
    { t: "Python", kind: "skill", chip: 5 },
    "，有 Agent 平台经验。",
  ],
  ["薪资待遇：", { t: "面议", kind: "risk", chip: 7 }, "，试用期 3 个月。"],
];
// 环绕的词：大小、倾斜、轨道高度各不相同；tone 决定颜色
const CHIPS = [
  { label: "需求文档", tone: "mint", y: -46, tilt: -4, size: 14 },
  { label: "Prompt", tone: "ink", y: 30, tilt: 3, size: 18 },
  { label: "工具调用", tone: "white", y: -14, tilt: 5, size: 13 },
  { label: "SQL", tone: "ink", y: 52, tilt: -6, size: 20 },
  { label: "RAG", tone: "mint", y: -38, tilt: 4, size: 16 },
  { label: "Python", tone: "white", y: 18, tilt: -3, size: 15 },
  { label: "待确认 · 工作强度", tone: "clay", y: -6, tilt: 5, size: 13 },
  { label: "待确认 · 薪资", tone: "clay", y: 40, tilt: -5, size: 14 },
  { label: "职责 · 3", tone: "dash", y: -52, tilt: 4, size: 13 },
  { label: "要求 · 2", tone: "dash", y: 8, tilt: -3, size: 13 },
  { label: "加分 · 1", tone: "dash", y: -26, tilt: 6, size: 13 },
] as const;
// 撞击时崩出的字：取自 JD 的字符与词，大小、颜色、飞出方向、弹跳高度各不相同（固定数值，保证每次一致）
const SPILL = [
  { c: "岗", s: 44, col: "g", dx: -330, b: 190, r: -28, d: 0 },
  { c: "位", s: 34, col: "k", dx: -250, b: 150, r: 22, d: 0.03 },
  { c: "职", s: 40, col: "c", dx: -170, b: 230, r: -40, d: 0.01 },
  { c: "责", s: 30, col: "g", dx: -90, b: 170, r: 35, d: 0.05 },
  { c: "SQL", s: 36, col: "k", dx: -20, b: 260, r: -12, d: 0.02 },
  { c: "需", s: 28, col: "g", dx: 60, b: 140, r: 30, d: 0.06 },
  { c: "求", s: 46, col: "c", dx: 130, b: 210, r: -34, d: 0.0 },
  { c: "RAG", s: 32, col: "g", dx: 210, b: 180, r: 18, d: 0.04 },
  { c: "面", s: 38, col: "c", dx: 290, b: 240, r: -22, d: 0.02 },
  { c: "议", s: 30, col: "k", dx: 350, b: 160, r: 44, d: 0.05 },
  { c: "加", s: 26, col: "g", dx: -300, b: 120, r: 16, d: 0.07 },
  { c: "班", s: 34, col: "c", dx: 320, b: 130, r: -30, d: 0.08 },
  { c: "Py", s: 28, col: "k", dx: -120, b: 110, r: -18, d: 0.09 },
  { c: "技", s: 36, col: "g", dx: 180, b: 120, r: 26, d: 0.06 },
] as const;
const FALL_MS = 615; // 撞击发生的时刻（先蓄力上提，再坠落）
const NEXT_MS = 1950; // 进入输入页的时间
const N = CHIPS.length;
const total = LINES.length;
// 抛在地上的“照片”：位置、角度、颜色
const PRINTS = [
  { k: "职责", n: 3, x: -250, y: 36, rot: -3, tone: "white" },
  { k: "技能", n: 6, x: -40, y: 78, rot: 2.5, tone: "mint" },
  { k: "加分", n: 1, x: 170, y: 22, rot: -3, tone: "white" },
  { k: "待确认", n: 2, x: 310, y: 92, rot: 3, tone: "clay" },
] as const;

export default function Intro({ onEnter }: { onEnter: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [reduceMotion, setReduceMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [leaving, setLeaving] = useState(false);
  const [geo, setGeo] = useState({ fall: 320, ground: 0 });
  const [done, setDone] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const controller = useRef<IntroController | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leavingRef = useRef(false);
  const [started] = useState(() => performance.now());
  const [mode, setMode] = useState<"css" | "three">("css");

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReduceMotion(media.matches);
      if (media.matches) {
        setDone(true);
        setMode("css");
      }
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduceMotion) return;
    let cancelled = false;
    const probe = document.createElement("canvas");
    let gl: WebGL2RenderingContext | null;
    try {
      gl = probe.getContext("webgl2");
    } catch {
      return;
    }
    if (!gl) return;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    import("./Intro3D")
      .then(({ mountIntro }) => {
        if (cancelled || leavingRef.current) return;
        try {
          controller.current = mountIntro(
            root,
            {
              chips: CHIPS,
              prints: PRINTS,
              spill: SPILL,
              scanStart: SCAN_START,
              scanTime: SCAN_TIME,
              fallMs: FALL_MS,
              started: started,
            },
            () => {
              controller.current?.dispose();
              controller.current = null;
              setMode("css");
            },
          );
          setMode("three");
        } catch {
          setMode("css");
        }
      })
      .catch(() => {
        if (!cancelled) setMode("css");
      });
    return () => {
      cancelled = true;
      controller.current?.dispose();
      controller.current = null;
    };
  }, [reduceMotion, started]);

  useEffect(() => () => clearTimeout(enterTimer.current), []);

  useEffect(() => {
    if (reduceMotion) return;
    const t = setTimeout(
      () => setDone(true),
      (SCAN_START + SCAN_TIME + 0.2) * 1000,
    );
    return () => clearTimeout(t);
  }, [reduceMotion, started]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduceMotion || mode === "three") return;
    // The hidden fallback is paused while WebGL is active; resume at the scene clock.
    root
      .querySelector(".scene")
      ?.getAnimations({ subtree: true })
      .forEach((a) => {
        a.currentTime = performance.now() - started;
      });
    const move = (e: PointerEvent) => {
      root.style.setProperty("--px", (e.clientX / innerWidth - 0.5).toFixed(3));
      root.style.setProperty(
        "--py",
        (e.clientY / innerHeight - 0.5).toFixed(3),
      );
    };
    addEventListener("pointermove", move);
    return () => removeEventListener("pointermove", move);
  }, [reduceMotion, mode, started]);

  const go = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    if (reduceMotion) {
      setLeaving(true);
      onEnter();
      return;
    }
    // 窗口顶在视口 28% 处、高约 330px；落到窗口脚底在视口 87% 的位置
    const win = rootRef.current!.querySelector<HTMLElement>(".scene .win")!;
    const fall = Math.max(
      20,
      innerHeight * 0.87 - (innerHeight * 0.28 + win.offsetHeight),
    );
    setGeo({ fall, ground: innerHeight * 0.87 });
    setLeaving(true);
    controller.current?.leave();
    enterTimer.current = setTimeout(onEnter, NEXT_MS);
  };
  const delayOf = (i: number) =>
    reduceMotion ? 0 : SCAN_START + (i / total) * SCAN_TIME;
  const chipLine = (c: number) =>
    LINES.findIndex((l) =>
      l.some((p) => typeof p !== "string" && p.chip === c),
    );

  return (
    <div
      className="intro"
      ref={rootRef}
      data-leaving={leaving}
      data-done={done}
      data-renderer={mode}
    >
      <div className="glow" aria-hidden="true" />
      <i className="blobA" aria-hidden="true" />
      <i className="blobB" aria-hidden="true" />
      <header className="intro-top">
        <span className="intro-brand">JDelight</span>
        <span className="intro-note">把一份岗位描述读透</span>
      </header>

      <div className="stack">
        <span className="scene" aria-hidden="true">
          <span className="floor">
            <i className="shadow" />
            <i className="ripple" />
            <i className="ripple r2" />
            <i
              className="beam"
              style={{ ["--s" as string]: `${SCAN_START}s` }}
            />
          </span>

          {/* 显影：解析结果像照片被抛在地上 */}
          <span className="prints">
            {PRINTS.map((p, i) => (
              <span
                key={p.k}
                className={`print ${p.tone}`}
                style={{
                  ["--x" as string]: `${p.x}px`,
                  ["--y" as string]: `${p.y}px`,
                  ["--rot" as string]: `${p.rot}deg`,
                  ["--n" as string]: p.n,
                  ["--d" as string]: `${SCAN_START + 0.4 + i * 0.42}s`,
                }}
              >
                <b className="pk">{p.k}</b>
                <b className="pn" />
              </span>
            ))}
          </span>

          <motion.span
            className="win-drop"
            initial={reduceMotion ? false : { y: "-95vh", rotate: -8 }}
            animate={
              mode === "three"
                ? { y: 0, rotate: 0 }
                : leaving
                  ? {
                      y: [
                        0,
                        -26,
                        geo.fall,
                        geo.fall - 96,
                        geo.fall,
                        geo.fall - 30,
                        geo.fall,
                      ],
                      scaleX: [1, 1.03, 1, 1.1, 0.96, 1.03, 1],
                      scaleY: [1, 0.97, 1, 0.9, 1.05, 0.97, 1],
                      rotate: [0, -2, 5, -3, 2, -1, 0],
                    }
                  : { y: 0, rotate: 0 }
            }
            transition={
              mode === "three"
                ? { duration: 0 }
                : leaving
                  ? {
                      duration: 1.5,
                      times: [0, 0.07, FALL_MS / 1500, 0.54, 0.68, 0.82, 1],
                      ease: [
                        "easeOut",
                        [0.55, 0, 1, 0.45],
                        "easeOut",
                        "easeIn",
                        "easeOut",
                        "easeIn",
                      ],
                    }
                  : { type: "spring", duration: 0.95, bounce: 0.28 }
            }
          >
            <span className="win-hop">
              <span className="win">
                <span className="win-bar" key={String(done)}>
                  <span className="win-title">
                    {done ? "已解析 · 6 个技能词 · 2 处待确认" : "岗位描述"}
                  </span>
                </span>
                <span className="win-body">
                  {LINES.map((line, li) => (
                    <span key={li} className="jl" data-head={line.length === 1}>
                      {line.map((p, pi) =>
                        typeof p === "string" ? (
                          <Fragment key={pi}>{p}</Fragment>
                        ) : (
                          <mark
                            key={pi}
                            className={`jt ${p.kind}`}
                            style={{ ["--d" as string]: `${delayOf(li)}s` }}
                          >
                            {p.t}
                          </mark>
                        ),
                      )}
                    </span>
                  ))}
                  <i
                    className="scan"
                    style={{
                      ["--s" as string]: `${SCAN_START}s`,
                      ["--t" as string]: `${SCAN_TIME}s`,
                    }}
                  />
                </span>
              </span>
              <span
                className="note"
                style={{
                  ["--s" as string]: `${SCAN_START + SCAN_TIME + 0.1}s`,
                }}
              >
                面议？
                <br />
                面试时问一下
              </span>
            </span>
          </motion.span>

          <span className="ring">
            {CHIPS.map((c, i) => {
              const li = c.tone === "dash" ? total - 1 : chipLine(i);
              return (
                <span
                  key={c.label}
                  className="slot"
                  style={{
                    ["--base" as string]: `${(360 / N) * i}deg`,
                    ["--y" as string]: `${c.y}px`,
                    ["--d" as string]: `${delayOf(li) + 0.15}s`,
                  }}
                >
                  <span
                    className={`chip3 ${c.tone}`}
                    style={{
                      fontSize: c.size,
                      ["--tilt" as string]: `${c.tilt}deg`,
                    }}
                  >
                    {c.label}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
        <button
          type="button"
          className="intro-enter"
          aria-label="开始：进入我的岗位"
          onClick={go}
          onFocus={() => controller.current?.focus(true)}
          onBlur={() => controller.current?.focus(false)}
        />
      </div>

      <p className="intro-hint" aria-hidden="true">
        悬停可以让它们停下，点击窗口，进入我的岗位
      </p>
      {leaving && !reduceMotion && mode === "css" && (
        <div className="spill" aria-hidden="true">
          {SPILL.map((g, i) => {
            const half = 170; // 窗口半高：字从窗口中部崩出，落在窗口脚下
            return (
              <motion.span
                key={i}
                className={`sp ${g.col}`}
                style={{ fontSize: g.s, top: geo.ground - g.s }}
                initial={{ x: 0, y: -half, rotate: 0, opacity: 0 }}
                animate={{
                  x: [0, 0.35, 0.6, 0.75, 0.86, 0.94, 0.98, 1].map(
                    (k) => g.dx * k,
                  ),
                  y: [-half, -half - g.b, 0, -g.b * 0.42, 0, -g.b * 0.16, 0, 0],
                  rotate: [0, 0.5, 0.8, 0.95, 1, 1.05, 1.08, 1.1].map(
                    (k) => g.r * k,
                  ),
                  opacity: [0, 1, 1, 1, 1, 1, 1, 0],
                }}
                transition={{
                  duration: 1.2,
                  delay: FALL_MS / 1000 + g.d,
                  times: [0, 0.18, 0.38, 0.52, 0.66, 0.78, 0.9, 1],
                  ease: [
                    "easeOut",
                    "easeIn",
                    "easeOut",
                    "easeIn",
                    "easeOut",
                    "easeIn",
                    "linear",
                  ],
                }}
              >
                {g.c}
              </motion.span>
            );
          })}
        </div>
      )}
      <div
        className="reveal"
        aria-hidden="true"
        style={{ ["--gy" as string]: "87vh" }}
      />
    </div>
  );
}
