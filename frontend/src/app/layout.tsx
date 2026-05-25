import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DroneSeg | Semantic Segmentation for Aerial Imagery",
  description: "Advanced land-cover identification platform using SegFormer-B2 and AI vision.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">{children}</body>
    </html>
  );
}
