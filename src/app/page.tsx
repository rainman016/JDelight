export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="font-serif text-5xl font-bold tracking-tight text-green sm:text-6xl">
        JDelight
      </h1>
      <p className="text-lg leading-relaxed text-ink-2">
        骨架已就绪，功能在后续工单中实现
      </p>
      <p className="text-sm leading-relaxed text-ink-3">
        数据只保存在这台设备的这个浏览器里
      </p>
    </main>
  );
}
