"use client";

import { toast } from "sonner";

/**
 * „Link kopieren“ (#47): volle Adresse eines Eintrags in die Zwischenablage, z. B. um sie Claude
 * oder ChatGPT zu schicken – die KI-Werkzeuge nehmen solche Links statt einer ID.
 */
export async function copyAppLink(path: string, message = "Link kopiert") {
  const url = new URL(path, window.location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    toast(message);
  } catch {
    toast.error("Link konnte nicht kopiert werden.");
  }
}
