import { WORKFLOW_CASES } from "../shared/workflow-contract";
import { withIsolatedDatabase } from "../helpers/database-isolation";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { repository } from "../../src/data/repository";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
import { QuestionDock } from "../../src/features/jobs/question-dock";
import { createAnchor } from "../../src/lib/anchor";
const ANCHOR_TEXT =
  "重复句子在这里。第一段是背景说明，不要把前面这句当成后面那句。重复句子在这里。为了检验跨行选择，继续保留足够长的中文：解释岗位时要联系原文中的具体措辞，区分要求程度、职责边界和需要进一步确认的事情。选中的文字可以跨过浏览器自动换行，也可以从后往前选择，刷新后应该仍然属于同一段。";
Object.assign(globalThis, {
  workflowRead: async () => (await repository().exportData()).data,
  seedAnchorJob: async () => {
    const repo = repository(),
      job = await repo.createJob(SAMPLE_JD, {
        title: "虚构选区验证岗位",
        company: "星桥科技",
        place: "上海",
      });
    const source = await repo.getSource(job),
      content = reportFor(source),
      block = content.sections[0].blocks[0];
    if (block.type !== "paragraph") throw new Error("选区测试需要段落");
    block.claims[0] = {
      ...block.claims[0],
      text: ANCHOR_TEXT,
      kind: "common",
      citations: [],
    };
    await repo.saveReport(job.id, source, content, null);
    return { jobId: job.id, blockId: block.blockId, text: ANCHOR_TEXT };
  },
  mountQuestionFailure: async (jobId: string) => {
    const data = await repository().readJob(jobId);
    if (!data?.report) throw new Error("失败测试缺少报告");
    const blockId = data.report.content.sections[0].blocks[0].blockId;
    const block = document.querySelector<HTMLElement>(
      `.detail-screen [data-block-id="${CSS.escape(blockId)}"]`,
    )!;
    const range = document.createRange();
    range.selectNodeContents(block);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(
      createElement(QuestionDock, {
        jobId,
        target: {
          anchor: {
            ...createAnchor(block, range),
            reportVersionId: data.report.id,
            sourceVersionId: data.report.sourceVersionId,
            offsetUnit: "utf16",
          },
          title: "岗位定位",
        },
        provider: async () => {
          throw new Error("仅测试：模拟解答失败");
        },
        onAdd: async () => {},
        onClose: () =>
          queueMicrotask(() => {
            root.unmount();
            host.remove();
          }),
      }),
    );
  },
});
Object.assign(globalThis, {
  runWorkflowContract: async () => {
    const results: { name: string; passed: boolean; error?: string }[] = [];
    for (const entry of WORKFLOW_CASES) {
      try {
        await withIsolatedDatabase(entry.run);
        results.push({ name: entry.name, passed: true });
      } catch (error) {
        results.push({ name: entry.name, passed: false, error: String(error) });
      }
    }
    return results;
  },
});
