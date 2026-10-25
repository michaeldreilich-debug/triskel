"use client";

import { useEffect, useState } from "react";
import { type DeviceInfo, isAppleTouchDevice } from "@/lib/install-hint";

export interface InstallState extends DeviceInfo {
  /** Browser-Werte sind gelesen (davor rendern Server und Browser gleich: nichts) */
  ready: boolean;
  /** läuft als App vom Home-Bildschirm */
  standalone: boolean;
  apple: boolean;
}

const SERVER_STATE: InstallState = {
  ready: false,
  userAgent: "",
  maxTouchPoints: 0,
  standalone: false,
  apple: false,
};

/** Läuft die Seite als App vom Home-Bildschirm? iOS: `navigator.standalone`, sonst display-mode. */
function readStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/** Gerät und App-Modus, erst nach dem Einhängen gelesen (kein Unterschied zum Server-HTML). */
export function useInstallState(): InstallState {
  const [state, setState] = useState<InstallState>(SERVER_STATE);
  useEffect(() => {
    const device = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
    setState({
      ready: true,
      ...device,
      standalone: readStandalone(),
      apple: isAppleTouchDevice(device),
    });
  }, []);
  return state;
}
