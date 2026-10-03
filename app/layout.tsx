import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

// Every figure on an admin screen is set in this: counts, UPRNs, thresholds.
const data = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian",
  display: "swap",
});

export const metadata: Metadata = {
  title: "nakolabs-d2d",
  description: "Canvassing management platform",
  // The manifest <link> comes from app/manifest.ts. iOS ignores the manifest
  // for install behaviour and reads these instead.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "nakolabs-d2d",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfaf8",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 2026-10-03 D2: the field boot script sets
    // data-field-theme before hydration. This only silences <html>'s own
    // attributes, not its children.
    <html
      lang="en-GB"
      className={`${display.variable} ${body.variable} ${data.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-white font-body text-zinc-900">{children}</body>
    </html>
  );
}
