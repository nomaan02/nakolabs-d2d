import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "nakolabs-d2d",
  description: "Canvassing management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
