import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Law RAG — OpenSearch Semantic, Hybrid & Graph",
  description: "RAG over law documents with explainable retrieval from OpenSearch",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
