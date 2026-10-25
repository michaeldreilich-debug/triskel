/**
 * Hinweis „Auf den Home-Bildschirm“ (E44 H1) als reine Entscheidung ohne Browserzugriff
 * (unit-getestet); die Komponente liest User-Agent, Touch-Punkte und App-Modus und übergibt sie.
 */

export interface DeviceInfo {
  userAgent: string;
  /** `navigator.maxTouchPoints` */
  maxTouchPoints: number;
}

/**
 * iPhone oder iPad? iPadOS meldet sich seit 13 wie ein Mac („Macintosh“ im User-Agent), hat aber
 * als Einziges unter den Macs einen Touchscreen (mehr als ein Berührpunkt).
 */
export function isAppleTouchDevice({ userAgent, maxTouchPoints }: DeviceInfo): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

export interface InstallHintInput extends DeviceInfo {
  /** läuft schon als App vom Home-Bildschirm (`navigator.standalone` bzw. display-mode) */
  standalone: boolean;
  /** „Verstanden“ auf diesem Gerät gewählt */
  dismissed: boolean;
}

/** iPhone (oder iPod) – ohne iPad. */
export function isIPhone({ userAgent }: DeviceInfo): boolean {
  return /\b(iPhone|iPod)\b/.test(userAgent);
}

/**
 * Zeigen: nur auf dem iPhone im Browser, solange nicht „Verstanden“ gewählt wurde. Das iPad
 * bekommt den Hinweis vorerst nicht: Ab 1024 px liegt das große Layout im App-Modus oben noch
 * unter der Statusleiste (Prüfung H4); die Anleitung in den Einstellungen bleibt für alle.
 */
export function shouldShowInstallHint(input: InstallHintInput): boolean {
  return isIPhone(input) && !input.standalone && !input.dismissed;
}

/** Die drei Schritte (Heute-Hinweis und Einstellungen › Auf dem Handy). */
export const INSTALL_STEPS = [
  "In Safari unten auf „Teilen“ tippen",
  "„Zum Home-Bildschirm“ wählen",
  "Triskel über das neue Symbol öffnen",
] as const;

export const INSTALL_NOTE = "In der App einmal neu anmelden – sie hat eigene Anmeldedaten.";
