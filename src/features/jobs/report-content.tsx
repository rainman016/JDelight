import { Fragment } from "react";
import type { Block, ReportContent } from "@/domain/report";
import type {
  ReportVersion,
  Supplement,
  SupplementSnapshot,
} from "@/domain/schema";
import { SECTION_TITLES, STRENGTH_LABEL } from "@/domain/report-presentation";
import { Citations, ClaimText, KindTag } from "./report-citations";
import { AskSection } from "./report-actions";
import { SupplementCard } from "./supplement-card";
import { AskedSummary } from "./question-list";

export function SupplementNotes({
  report,
  blockId,
}: {
  report: ReportVersion;
  blockId: string;
}) {
  const notes = report.supplements.filter(
    (item) => item.anchor.blockId === blockId,
  );
  return notes.length ? (
    <ul className="jd-supplements">
      {notes.map((item) => (
        <SupplementCard
          key={`${item.supplementId}-${item.answer}`}
          item={item}
        />
      ))}
    </ul>
  ) : null;
}
export function Focus({ report }: { report: ReportVersion }) {
  return (
    <section className="jd-first" aria-label="面试重点速览">
      <h2 className="jd-block-title">
        面试重点速览 <small>1 岗位速览</small>
        <AskSection blockId={report.content.focus.gist.id} title="岗位速览" />
      </h2>
      <p className="jd-gist" data-block-id={report.content.focus.gist.id}>
        <ClaimText item={report.content.focus.gist} />
      </p>
      <SupplementNotes report={report} blockId={report.content.focus.gist.id} />
      <ol className="jd-focus">
        {report.content.focus.items.map((item) => (
          <li key={item.id}>
            <div data-block-id={item.id}>
              <p className="jd-focus-text">{item.text}</p>
              <p className="jd-basis">{item.basis}</p>
              <div className="focus-m">
                <KindTag kind={item.kind} />
                <Citations items={item.citations} />
              </div>
            </div>
            <SupplementNotes report={report} blockId={item.id} />
          </li>
        ))}
      </ol>
    </section>
  );
}
function ReportBlock({
  block,
}: {
  block: Exclude<Block, { type: "requirement" | "scenario" }>;
}) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="jd-para">
          {block.claims.map((item) => (
            <span key={item.id}>
              <ClaimText item={item} />{" "}
            </span>
          ))}
        </p>
      );
    case "capability":
      return (
        <div className="jd-capability">
          <h3>
            {block.name}{" "}
            <small>重要程度：{block.importance === "high" ? "高" : "中"}</small>
          </h3>
          {block.meaning.map((item) => (
            <p className="jd-para" key={item.id}>
              <ClaimText item={item} />
            </p>
          ))}
        </div>
      );
    case "probe":
      return (
        <p className="jd-probe">
          <ClaimText item={block.claim} />
        </p>
      );
    case "question":
      return (
        <div className="jd-question">
          <h3>{block.question}</h3>
          <p>为什么要问：{block.why}</p>
          <Citations items={block.citations} />
        </div>
      );
  }
}
function SectionBlocks({
  blocks,
  report,
}: {
  blocks: Block[];
  report: ReportVersion;
}) {
  const groups: Block[][] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    if (
      (block.type === "requirement" || block.type === "scenario") &&
      previous?.[0].type === block.type
    )
      previous.push(block);
    else groups.push([block]);
  }
  return groups.map((group) => {
    const first = group[0];
    const type = first.type;
    if (type === "requirement" || type === "scenario") {
      const labels =
        type === "requirement"
          ? ["关键措辞", "程度", "说明"]
          : ["场景", "可能的产品", "可能的难点"];
      return (
        <table
          className="jd-table"
          key={first.blockId}
          aria-label={type === "requirement" ? "任职门槛" : "场景推测"}
        >
          <thead>
            <tr>
              {labels.map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.map((block) => (
              <Fragment key={block.blockId}>
                <tr className="jd-block" data-block-id={block.blockId}>
                  {block.type === "requirement" && (
                    <>
                      <td data-label={labels[0]}>
                        <strong>“{block.phrase}”</strong>
                        <Citations items={block.citations} />
                      </td>
                      <td data-label={labels[1]}>
                        {STRENGTH_LABEL[block.strength]}
                        {block.degree && (
                          <span className="jd-table-degree">
                            程度词：{block.degree}
                          </span>
                        )}
                      </td>
                      <td data-label={labels[2]}>
                        <ClaimText item={block.note} />
                      </td>
                    </>
                  )}
                  {block.type === "scenario" && (
                    <>
                      <td data-label={labels[0]}>{block.scene}</td>
                      <td data-label={labels[1]}>
                        <ClaimText item={block.product} />
                      </td>
                      <td data-label={labels[2]}>
                        <ClaimText item={block.difficulty} />
                      </td>
                    </>
                  )}
                </tr>
                {report.supplements.some(
                  (item) => item.anchor.blockId === block.blockId,
                ) && (
                  <tr>
                    <td colSpan={3}>
                      <SupplementNotes
                        report={report}
                        blockId={block.blockId}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      );
    }
    return (
      <div className={`jd-block jd-block-${type}`} key={first.blockId}>
        <div data-block-id={first.blockId}>
          <ReportBlock block={first} />
        </div>
        <SupplementNotes report={report} blockId={first.blockId} />
      </div>
    );
  });
}
export function ReportBody({ report }: { report: ReportVersion }) {
  return (
    <div className="jd-report">
      <section aria-label="报告阅读说明" className="jd-report-head">
        <div className="jd-facts">
          {report.content.header.shown.map((item) => (
            <span className="jd-fact" key={item.id}>
              {item.text}
              <Citations items={item.citations} />
            </span>
          ))}
          {report.content.header.missing.map((item) => (
            <span className="jd-fact jd-missing" key={item}>
              {item}：未显示
            </span>
          ))}
        </div>
        <p className="jd-read-note">
          只依据你确认的原文。点出处可查看依据。
          <KindTag kind="inference" />
          是从原文措辞读出来的，
          <KindTag kind="speculation" />
          是结合行业常识的猜测，
          <KindTag kind="common" />
          是行业里常见的做法，都不是招聘方说过的话。
        </p>
      </section>
      <Focus report={report} />
      {report.content.sections.map((section, index) => (
        <section
          key={section.key}
          className="jd-section"
          aria-label={`${index + 2} ${SECTION_TITLES[section.key]}`}
        >
          <h2 className="jd-block-title">
            <span className="jd-section-no">{index + 2}</span>
            {SECTION_TITLES[section.key]}
            <AskSection
              blockId={section.blocks[0]?.blockId}
              title={SECTION_TITLES[section.key]}
            />
          </h2>
          {section.status === "not_in_source" ? (
            <p className="jd-not-in-source">原文未体现</p>
          ) : (
            <SectionBlocks blocks={section.blocks} report={report} />
          )}
        </section>
      ))}
    </div>
  );
}
export function confirmQuestions(content: ReportContent) {
  return (
    content.sections
      .find((section) => section.key === "toConfirm")
      ?.blocks.filter((block) => block.type === "question") ?? []
  );
}
export function Brief({
  report,
  questions = report.supplements,
}: {
  report: ReportVersion;
  questions?: (Supplement | SupplementSnapshot)[];
}) {
  return (
    <article className="jd-brief-paper">
      <span className="jd-paper-tag">面试前，翻这一页</span>
      <h2 className="jd-paper-title">最该准备的重点</h2>
      <ol className="jd-brief-focus">
        {report.content.focus.items.map((item) => (
          <li key={item.id}>
            <strong>{item.text}</strong>
            <span className="jd-basis">{item.basis}</span>
            <span>
              <KindTag kind={item.kind} />
              <Citations items={item.citations} />
            </span>
          </li>
        ))}
      </ol>
      <section className="jd-brief-section">
        <h2>岗位一句话</h2>
        <p className="jd-brief-gist">
          <ClaimText item={report.content.focus.gist} />
        </p>
      </section>
      <AskedSummary items={questions} />
      <section className="jd-brief-section">
        <h2>可以反问</h2>
        {confirmQuestions(report.content).length ? (
          confirmQuestions(report.content).map((item) => (
            <div className="jd-question" key={item.blockId}>
              <h3>{item.question}</h3>
              <p>为什么要问：{item.why}</p>
              <Citations items={item.citations} />
            </div>
          ))
        ) : (
          <p>原文未体现</p>
        )}
      </section>
      <p className="jd-paper-foot">
        只依据你确认的原文整理；重点是准备方向，推测不代表真实面试题。
      </p>
    </article>
  );
}
