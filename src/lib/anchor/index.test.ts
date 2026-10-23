import { afterEach, describe, expect, test } from "vitest";
import {
  createAnchor,
  getAnchorText,
  resolveAnchor,
  type TextAnchor,
} from "./index";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function block(html: string, id = "block-a") {
  const element = document.createElement("p");
  element.dataset.blockId = id;
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

function select(element: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  range.setStart(element.firstChild!, start);
  range.setEnd(element.firstChild!, end);
  return createAnchor(element, range);
}

describe("createAnchor：UTF-16、块边界与原始文本", () => {
  test("普通中文：记录原句、半开偏移和上下文", () => {
    expect(select(block("需要数据分析能力。"), 2, 6)).toEqual({
      blockId: "block-a",
      start: 2,
      end: 6,
      exact: "数据分析",
      prefix: "需要",
      suffix: "能力。",
    });
  });

  test("同一句出现两次仍准确保存第二次位置", () => {
    const element = block("数据分析；数据分析。");
    const anchor = select(element, 5, 9);
    expect(anchor.exact).toBe("数据分析");
    expect(resolveAnchor(getAnchorText(element), anchor)).toEqual({
      start: 5,
      end: 9,
      status: "exact",
    });
  });

  test("不折叠空白或全角标点", () => {
    expect(select(block("要求：  数据\n分析，完成！"), 3, 11).exact).toBe(
      "  数据\n分析，",
    );
  });

  test("emoji 前后的索引保持 UTF-16 单位", () => {
    expect(select(block("甲😀数据，乙"), 1, 5)).toMatchObject({
      start: 1,
      end: 5,
      exact: "😀数据",
    });
  });

  test("半个代理对的选择向外扩展为完整 emoji", () => {
    expect(select(block("甲😀乙"), 2, 3)).toMatchObject({
      start: 1,
      end: 3,
      exact: "😀",
    });
  });

  test("不拆开含肤色与 ZWJ 的复合 emoji", () => {
    const emoji = "👩🏽‍💻";
    expect(select(block(`甲${emoji}乙`), 2, 3)).toMatchObject({
      start: 1,
      end: 1 + emoji.length,
      exact: emoji,
    });
  });

  test("上下文各取 32 个码点，emoji 不被截成半个", () => {
    const left = "😀".repeat(40);
    const right = "文".repeat(40);
    const anchor = select(
      block(left + "选中" + right),
      left.length,
      left.length + 2,
    );
    expect(anchor.prefix).toBe("😀".repeat(32));
    expect(anchor.suffix).toBe("文".repeat(32));
  });

  test("跨两个行内元素仍按 textContent 连续计算", () => {
    const element = block("需要<strong>数据</strong><em>分析</em>能力");
    const range = document.createRange();
    range.setStart(element.querySelector("strong")!.firstChild!, 0);
    range.setEnd(element.querySelector("em")!.firstChild!, 2);
    expect(createAnchor(element, range)).toMatchObject({
      start: 2,
      end: 6,
      exact: "数据分析",
    });
  });

  test("反向 Selection 的 Range 仍生成正序偏移", () => {
    const element = block("需要数据分析能力");
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(element.firstChild!, 6, element.firstChild!, 2);
    expect(createAnchor(element, selection.getRangeAt(0))).toMatchObject({
      start: 2,
      end: 6,
      exact: "数据分析",
    });
  });

  test("跨两个块明确报错，不静默截断", () => {
    const first = block("第一块");
    const second = block("第二块", "block-b");
    const range = document.createRange();
    range.setStart(first.firstChild!, 1);
    range.setEnd(second.firstChild!, 2);
    expect(() => createAnchor(first, range)).toThrow("不支持跨块选择");
  });

  test("空选择与缺少块身份不能生成锚点", () => {
    const element = block("文字");
    const range = document.createRange();
    range.setStart(element.firstChild!, 1);
    range.collapse(true);
    expect(() => createAnchor(element, range)).toThrow("非空");
    element.removeAttribute("data-block-id");
    expect(() => createAnchor(element, range)).toThrow("data-block-id");
  });

  test("跨类型标签与出处按钮，只保留正文并按正文计算上下文", () => {
    const element = block(
      "<span>前文</span><span data-anchor-ignore><b>推断</b></span>" +
        "<strong>通常先核实。</strong><span data-anchor-ignore><button>职责第 1 条</button></span>" +
        "<em>再准备案例。</em><span data-anchor-ignore>说明</span><span>后文</span>",
    );
    const range = document.createRange();
    range.setStart(element, 1);
    range.setEnd(element, 6);
    expect(createAnchor(element, range)).toEqual({
      blockId: "block-a",
      start: 2,
      end: 14,
      exact: "通常先核实。再准备案例。",
      prefix: "前文",
      suffix: "后文",
    });
    expect(element.querySelector("button")).toHaveTextContent("职责第 1 条");
  });

  test("选区两端落在界面文字内部时仍只计算夹住的正文", () => {
    const element = block(
      "前文<span data-anchor-ignore>推断</span>正文通常<button data-anchor-ignore>职责第 1 条</button>后文",
    );
    const range = document.createRange();
    range.setStart(element.querySelector("span")!.firstChild!, 1);
    range.setEnd(element.querySelector("button")!.firstChild!, 3);
    expect(createAnchor(element, range)).toMatchObject({
      start: 2,
      end: 6,
      exact: "正文通常",
      prefix: "前文",
      suffix: "后文",
    });
  });

  test("只选中界面标签不生成问题锚点", () => {
    const element = block("正文<span data-anchor-ignore>推断</span>后文");
    const range = document.createRange();
    range.selectNodeContents(element.querySelector("span")!);
    expect(() => createAnchor(element, range)).toThrow("非空文字");
  });

  test("整节摘录与恢复共用正文投影，标签改名不影响位置", () => {
    const element = block(
      "<span data-anchor-ignore>通常</span>正文里通常二字要保留。<button data-anchor-ignore>职责第 1 条</button>",
    );
    const range = document.createRange();
    range.selectNodeContents(element);
    const anchor = createAnchor(element, range);
    expect(anchor.exact).toBe("正文里通常二字要保留。");
    element.querySelector("button")!.textContent = "原文第 100 行";
    expect(resolveAnchor(getAnchorText(element), anchor)).toEqual({
      start: 0,
      end: anchor.exact.length,
      status: "exact",
    });
  });
});

describe("resolveAnchor：原位、重定位与失配", () => {
  test("在选区前插入文字后 relocated", () => {
    const anchor = select(block("需要数据分析能力。"), 2, 6);
    expect(resolveAnchor("新增要求：需要数据分析能力。", anchor)).toEqual({
      start: 7,
      end: 11,
      status: "relocated",
    });
  });

  test("删掉被选文字后 lost", () => {
    const anchor = select(block("需要数据分析能力。"), 2, 6);
    expect(resolveAnchor("需要能力。", anchor)).toEqual({
      start: null,
      end: null,
      status: "lost",
    });
  });

  test("原句重复时用独特前后文找回", () => {
    const text = "甲岗位需要数据分析，乙岗位也需数据分析。";
    const start = text.lastIndexOf("数据分析");
    const anchor = select(block(text), start, start + 4);
    const changed = "更新：" + text;
    expect(resolveAnchor(changed, anchor)).toEqual({
      start: start + 3,
      end: start + 7,
      status: "relocated",
    });
  });

  test("两个候选有相同上下文时 lost，不用最近位置猜", () => {
    const text = "甲".repeat(40) + "数据分析" + "乙".repeat(40);
    const anchor = select(block(text), 40, 44);
    expect(resolveAnchor("新增" + text + "分隔" + text, anchor).status).toBe(
      "lost",
    );
  });

  test("重句均无完整上下文支持时 lost", () => {
    const anchor = select(block("需要数据分析能力"), 2, 6);
    expect(resolveAnchor("数据分析，再做数据分析", anchor).status).toBe("lost");
  });

  test("不会把损坏的偏移或半个 emoji 原样恢复", () => {
    const anchor = select(block("甲😀乙"), 1, 3);
    expect(resolveAnchor("甲😀乙", { ...anchor, start: -1 }).status).toBe(
      "lost",
    );
    const half: TextAnchor = { ...anchor, start: 2, end: 3, exact: "\ude00" };
    expect(resolveAnchor("甲😀乙", half).status).toBe("lost");
  });
});
