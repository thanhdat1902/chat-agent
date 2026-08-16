import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Org Agent Memory",
  description:
    "Personal, team, and organization memory for agents — with the permission boundary in SQL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
