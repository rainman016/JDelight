import { repository } from "@/data/repository";
export async function downloadBackup() {
  const snapshot = await repository().exportData();
  const filename = `jdelight-备份-${snapshot.data.exportedAt.slice(0, 10)}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot.data, null, 2)], {
      type: "application/json",
    }),
  );
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
    await repository().markExported(
      snapshot.data.exportedAt,
      snapshot.revision,
      snapshot.data.reportVersions
        .filter((report) => report.change.kind === "base")
        .map((report) => report.id),
    );
    return {
      filename,
      jobs: snapshot.data.jobs.length,
      versions: snapshot.data.reportVersions.length,
      notes: snapshot.data.supplements.length,
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
