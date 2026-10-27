import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@/styles/app.css";
import "@/styles/detail.css";
import "@/styles/workflow.css";
import "@/styles/trial-experience.css";
import { AppExperience } from "@/features/trial/experience";

export const metadata: Metadata = {
  title: "JDelight",
  description: "读透一份 JD，面试前从容回看。",
  icons: { icon: "data:," },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-paper font-sans text-ink antialiased">
        <AppExperience />
        {children}
      </body>
    </html>
  );
}
