import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme";

/**
 * Web-App-Manifest (E44 H1): Triskel lässt sich am Handy auf den Home-Bildschirm legen und startet
 * dort ohne Browserleiste auf Heute. Kein Service Worker, kein Offline (Nicht-Ziel). Das Manifest
 * ist ohne Anmeldung abrufbar (`PUBLIC_FILES` in `src/lib/auth/routes.ts`) – Safari lädt es ohne
 * Cookies. Das Symbol `icon.png` hat einen runden Kern mit viel Rand und trägt deshalb auch die
 * Maske („maskable“); `apple-icon.png` nimmt iOS selbst.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Triskel",
    short_name: "Triskel",
    description: "Wissensspeicher, Projektsteuerung und Rückblicke",
    lang: "de",
    start_url: "/heute",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
