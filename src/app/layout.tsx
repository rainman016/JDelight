import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/styles/app.css";

export const metadata: Metadata = {
  title: "JDelight",
  description: "读透一份 JD，面试前从容回看。",
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
