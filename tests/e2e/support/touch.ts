import type { Locator, Page } from "@playwright/test";

/**
 * Echte Touch-Geste über CDP (Chromium): Touch- und Pointer-Ereignisse samt touch-action, also
 * wie am Handy – senkrechtes Wischen scrollt, waagrechtes erreicht die App.
 * dx/dy als Anteil der Zeilenbreite bzw. in Pixeln (dy). `stepMs` > 0 wischt langsam.
 */
export async function swipe(
  page: Page,
  target: Locator,
  { dx = 0, dy = 0, steps = 10, stepMs = 16, holdMs = 0 } = {},
) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Zeile nicht sichtbar");
  const distance = dx * box.width;
  // links wischen von rechts beginnen (und umgekehrt), damit der Finger im Bild bleibt
  const startX = distance < 0 ? box.x + box.width - 24 : box.x + 64;
  const startY = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x?: number, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x === undefined ? [] : [{ x, y: y as number }],
    } as never);
  await touch("touchStart", startX, startY);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", startX + (distance * i) / steps, startY + (dy * i) / steps);
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await touch("touchEnd");
  await cdp.detach();
}
