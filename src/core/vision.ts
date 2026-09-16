import { Page } from '@playwright/test';

// Scoped to the main page only (not content inside an <iframe>) — resolving a vision point back to
// a DOM node requires document.elementFromPoint in the same frame the screenshot was taken in, and
// mapping a page-level screenshot's coordinates into an arbitrary nested frame's own coordinate
// space is a separate, harder problem this pass doesn't take on.

export type CapturedScreenshot = { imageBase64: string; width: number; height: number };

// `scale: 'css'` keeps the PNG's pixel dimensions equal to CSS pixels (ignoring devicePixelRatio),
// matching document.documentElement.scrollWidth/scrollHeight exactly — otherwise a point normalized
// against the wrong dimensions would land on the wrong element on any non-1x display.
export async function captureFullPageScreenshot(page: Page, timeoutMs: number): Promise<CapturedScreenshot | null> {
  try {
    const dims = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    if (dims.width <= 0 || dims.height <= 0) return null;

    const buffer = await page.screenshot({ fullPage: true, scale: 'css', timeout: timeoutMs });
    return { imageBase64: buffer.toString('base64'), width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

const HEAL_TAG_ATTRIBUTE = 'data-qash-heal-id';

export function visionTagSelector(tagId: string): string {
  return `[${HEAL_TAG_ATTRIBUTE}="${tagId}"]`;
}

// Converts the model's normalized (0-1000 per axis) point into a document-relative pixel using the
// dimensions the screenshot was actually captured at, scrolls that position into view (elementFromPoint
// only sees the current viewport), and tags whatever real element is there with a random, one-off
// attribute — giving the caller an unambiguous, exact-match locator for it without needing to
// reconstruct a description of the element from the image itself.
export async function tagElementAtVisionPoint(
  page: Page,
  point: { x: number; y: number },
  captured: CapturedScreenshot
): Promise<string | null> {
  const docX = (point.x / 1000) * captured.width;
  const docY = (point.y / 1000) * captured.height;

  try {
    return await page.evaluate(
      ({ docX, docY, attr }) => {
        window.scrollTo({ left: Math.max(0, docX - window.innerWidth / 2), top: Math.max(0, docY - window.innerHeight / 2) });
        const viewportX = docX - window.scrollX;
        const viewportY = docY - window.scrollY;
        const el = document.elementFromPoint(viewportX, viewportY);
        if (!el || el === document.documentElement || el === document.body) return null;

        const tagId = `qash-heal-${Math.random().toString(36).slice(2)}`;
        el.setAttribute(attr, tagId);
        return tagId;
      },
      { docX, docY, attr: HEAL_TAG_ATTRIBUTE }
    );
  } catch {
    return null;
  }
}

// Best-effort: the healed action itself may have removed/replaced the tagged element (e.g. it was
// a "dismiss" or "delete" control), so a failure here is expected sometimes and not worth surfacing.
export async function cleanupVisionTag(page: Page, tagId: string): Promise<void> {
  try {
    await page
      .locator(visionTagSelector(tagId))
      .evaluate((el, attr) => el.removeAttribute(attr), HEAL_TAG_ATTRIBUTE);
  } catch {
    // Ignore — see above.
  }
}
