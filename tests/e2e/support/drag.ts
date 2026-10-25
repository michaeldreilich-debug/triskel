import type { Locator, Page } from "@playwright/test";

const center = async (locator: Locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element ohne Position – nicht sichtbar?");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * Ziehen mit der Maus in Schritten (dnd-kit startet erst nach 6 px Bewegung): greifen, über die
 * Fläche fahren – loslassen mit `releaseDrag`. So lässt sich dazwischen prüfen, was die Fläche
 * beim Ziehen zeigt.
 */
export async function holdDrag(page: Page, source: Locator, target: Locator) {
  const from = await center(source);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 4 });
  const to = await center(target);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // einmal rütteln, damit dnd-kit die Fläche unter dem Zeiger sicher erkennt
  await page.mouse.move(to.x + 2, to.y + 2, { steps: 2 });
}

export async function releaseDrag(page: Page) {
  await page.mouse.up();
}

/** Ziehen und loslassen in einem Zug. */
export async function dragTo(page: Page, source: Locator, target: Locator) {
  await holdDrag(page, source, target);
  await releaseDrag(page);
}
