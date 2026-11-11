import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minimi Chat",
  description: "A chat agent with web search and memory.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
