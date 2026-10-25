import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Newsreader } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COLORS } from "@/lib/theme";
import { parseUiPrefs } from "@/lib/ui-prefs";
import { Providers } from "./providers";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Triskel", template: "%s · Triskel" },
  description: "Wissensspeicher, Projektsteuerung und Rückblicke",
  robots: { index: false, follow: false },
  // Home-Bildschirm am iPhone (E44 H1): startet ohne Browserleiste; der Inhalt reicht unter die
  // Statusleiste (black-translucent), die Ränder hält env(safe-area-inset-*) frei
  applicationName: "Triskel",
  appleWebApp: { capable: true, title: "Triskel", statusBarStyle: "black-translucent" },
};

/** Farbe der Statusleiste folgt dem Theme dieses Geräts (Cookie wie im Layout). */
export async function generateViewport(): Promise<Viewport> {
  const cookieStore = await cookies();
  const ui = parseUiPrefs((name) => cookieStore.get(name)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: THEME_COLORS[ui.theme],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const ui = parseUiPrefs((name) => cookieStore.get(name)?.value);

  return (
    <html
      lang="de"
      data-theme={ui.theme}
      data-font={ui.fontSize}
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`}
    >
      <body>
        <Providers ui={ui}>{children}</Providers>
      </body>
    </html>
  );
}
