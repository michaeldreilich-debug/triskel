import { describe, expect, it } from "vitest";
import { isAppleTouchDevice, shouldShowInstallHint } from "./install-hint";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

const base = { standalone: false, dismissed: false };

describe("Hinweis „Auf den Home-Bildschirm“", () => {
  it("zeigt sich auf dem iPhone im Browser", () => {
    expect(shouldShowInstallHint({ ...base, userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
  });

  it("erkennt iPadOS mit Mac-Kennung nur mit Touchscreen", () => {
    expect(isAppleTouchDevice({ userAgent: IPAD_MAC_UA, maxTouchPoints: 5 })).toBe(true);
    // ein echter Mac meldet 0 Berührpunkte
    expect(isAppleTouchDevice({ userAgent: IPAD_MAC_UA, maxTouchPoints: 0 })).toBe(false);
    expect(shouldShowInstallHint({ ...base, userAgent: IPAD_MAC_UA, maxTouchPoints: 0 })).toBe(
      false,
    );
  });

  it("zeigt sich vorerst nicht auf dem iPad (großes Layout im App-Modus noch ohne Rand oben)", () => {
    expect(shouldShowInstallHint({ ...base, userAgent: IPAD_MAC_UA, maxTouchPoints: 5 })).toBe(
      false,
    );
    const ipad =
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(shouldShowInstallHint({ ...base, userAgent: ipad, maxTouchPoints: 5 })).toBe(false);
  });

  it("nie am Desktop und nie auf Android", () => {
    expect(shouldShowInstallHint({ ...base, userAgent: WINDOWS, maxTouchPoints: 10 })).toBe(false);
    expect(shouldShowInstallHint({ ...base, userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });

  it("nicht, wenn Triskel schon als App läuft", () => {
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE,
        maxTouchPoints: 5,
        standalone: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("nicht nach „Verstanden“", () => {
    expect(
      shouldShowInstallHint({
        userAgent: IPHONE,
        maxTouchPoints: 5,
        standalone: false,
        dismissed: true,
      }),
    ).toBe(false);
  });
});
