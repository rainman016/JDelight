import type { Supplement, SupplementSnapshot } from "@/domain/schema";
import { KIND_LABEL } from "@/domain/report-presentation";
export function QuestionList({
  notes,
  onOpen,
}: {
  notes: Supplement[];
  onOpen: (note: Supplement) => void;
}) {
  return (
    <section className="jd-questions" aria-label="我的疑问与补充">
      <h2 className="jd-block-title">我的疑问与补充</h2>
      {!notes.length ? (
        <p className="hand-small">还没有疑问。选中报告文字，或点“问这一节”。</p>
      ) : (
        <ul className="jd-question-list">
          {notes.map((note) => (
            <li key={note.id} data-unanswered={note.status === "unanswered"}>
              <span className="jd-supplement-meta">
                {note.status === "unanswered"
                  ? "未解答"
                  : note.status === "added"
                    ? `第 ${note.addedInVersion} 版加入`
                    : note.status === "withdrawn"
                      ? "已撤下，旧版本仍可查看"
                      : `未加入报告 · ${note.answerKind === "common" ? "示例解答 · 通常" : KIND_LABEL[note.answerKind]}`}
              </span>
              <strong>{note.question}</strong>
              <p className="jd-note-selection">你选中的：{note.anchor.exact}</p>
              {note.status !== "added" && (
                <p>{note.answer || "问题已经记下，稍后可以重试。"}</p>
              )}
              {(note.status === "unanswered" || note.status === "answered") && (
                <button
                  type="button"
                  className="jd-link"
                  onClick={() => onOpen(note)}
                >
                  {note.status === "unanswered" ? "重试解答" : "查看解答"}
                </button>
              )}
              {note.status === "added" && (
                <button
                  type="button"
                  className="jd-link"
                  onClick={() =>
                    document
                      .querySelector<HTMLElement>(
                        `[data-supplement-id="${CSS.escape(note.id)}"]`,
                      )
                      ?.scrollIntoView({ block: "center" })
                  }
                >
                  在报告原位查看
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function AskedSummary({
  items,
}: {
  items: (Supplement | SupplementSnapshot)[];
}) {
  return (
    <section className="jd-brief-section" aria-label="我问过的">
      <h2>我问过的</h2>
      {items.length ? (
        <ul className="jd-question-list">
          {items.map((item) => (
            <li key={"id" in item ? item.id : item.supplementId}>
              <strong>{item.question}</strong>
              <span className="jd-supplement-meta">
                {"status" in item && item.status === "unanswered"
                  ? "未解答"
                  : item.answerKind === "common"
                    ? "示例解答 · 通常"
                    : KIND_LABEL[item.answerKind]}
              </span>
              <p>{item.answer || "问题已记下，回到完整报告可以重试。"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>还没有疑问。</p>
      )}
    </section>
  );
}
