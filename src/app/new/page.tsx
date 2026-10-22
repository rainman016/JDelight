import NewJob from "@/features/jobs/new-job";
export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string; demo?: string }>;
}) {
  const params = await searchParams;
  return (
    <NewJob
      key={params.retry ?? "new"}
      retry={params.retry}
      demoFail={params.demo === "fail"}
    />
  );
}
