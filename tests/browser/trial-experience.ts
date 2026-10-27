import { repository } from "../../src/data/repository";
import { reportFor, SAMPLE_JD } from "../../src/providers/mock";
const helpers = {
  async seed(count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const job = await repository().createJob(SAMPLE_JD, {
        title: `虚构试用岗位 ${i + 1}`,
        company: "星桥科技",
        place: "上海",
      });
      const source = await repository().getSource(job);
      await repository().saveReport(job.id, source, reportFor(source), null);
      ids.push(job.id);
    }
    return ids;
  },
  async data() {
    return (await repository().exportData()).data;
  },
  async status() {
    return repository().backupStatus();
  },
  async oldExport() {
    const snapshot = await repository().exportData();
    await repository().markExported(
      new Date(Date.now() - 8 * 86_400_000).toISOString(),
      snapshot.revision,
      snapshot.data.reportVersions
        .filter((report) => report.change.kind === "base")
        .map((report) => report.id),
    );
  },
};
(globalThis as unknown as { wo005: typeof helpers }).wo005 = helpers;
export type TrialExperienceHelpers = typeof helpers;
