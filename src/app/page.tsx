"use client";
import dynamic from "next/dynamic";
const Home = dynamic(() => import("@/features/jobs/home"), {
  ssr: false,
  loading: () => (
    <main className="loading" role="status">
      正在打开我的岗位…
    </main>
  ),
});
export default function HomePage() {
  return <Home />;
}
