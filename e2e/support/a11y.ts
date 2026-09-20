import type { Page } from "@playwright/test";

export type UnnamedControl = {
  /** `select`, `button`, … — what the control is. */
  readonly tag: string;
  /** Enough surrounding text to find it on the page. */
  readonly near: string;
};

/**
 * Every control on the page that a screen reader would announce with no name
 * at all.
 *
 * A control with no accessible name is read out as just "button" or
 * "combobox", which tells someone using a screen reader nothing about what
 * it does. This walks the real DOM and applies the same name sources the
 * accessibility tree uses, in the order the HTML-AAM specification gives:
 * `aria-labelledby`, then `aria-label`, then the native label (a `for=`
 * label or a wrapping one), then `title`, then — for the elements whose
 * content is their name, such as a button or a link — the text inside.
 *
 * `placeholder` is deliberately not accepted: browsers fall back to it, but
 * it disappears the moment anything is typed, so a field that relies on it
 * loses its name exactly when someone is using it.
 */
export function unnamedControls(page: Page): Promise<UnnamedControl[]> {
  return page.evaluate(() => {
    const CONTENT_NAMED = new Set(["BUTTON", "A", "SUMMARY"]);

    function textOf(element: Element | null): string {
      return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
    }

    function labelledByText(element: Element): string {
      const ids = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter((id) => id !== "");
      return ids
        .map((id) => textOf(document.getElementById(id)))
        .join(" ")
        .trim();
    }

    function nativeLabelText(element: Element): string {
      const labels = (element as HTMLInputElement).labels;
      if (labels !== undefined && labels !== null && labels.length > 0) {
        return Array.from(labels).map(textOf).join(" ").trim();
      }
      return textOf(element.closest("label"));
    }

    function accessibleName(element: Element): string {
      const fromLabelledBy = labelledByText(element);
      if (fromLabelledBy !== "") {
        return fromLabelledBy;
      }
      const fromAriaLabel = (element.getAttribute("aria-label") ?? "").trim();
      if (fromAriaLabel !== "") {
        return fromAriaLabel;
      }
      const fromLabel = nativeLabelText(element);
      if (fromLabel !== "") {
        return fromLabel;
      }
      const fromTitle = (element.getAttribute("title") ?? "").trim();
      if (fromTitle !== "") {
        return fromTitle;
      }
      if (CONTENT_NAMED.has(element.tagName)) {
        const content = textOf(element);
        if (content !== "") {
          return content;
        }
        const image = element.querySelector("img[alt]");
        return (image?.getAttribute("alt") ?? "").trim();
      }
      if (element.tagName === "INPUT") {
        const input = element as HTMLInputElement;
        if (input.type === "submit" || input.type === "button") {
          return input.value.trim();
        }
      }
      return "";
    }

    const selector = "button, a[href], input, select, textarea, summary";
    return Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        if (element.closest('[aria-hidden="true"]') !== null) {
          return false;
        }
        if (element instanceof HTMLInputElement && element.type === "hidden") {
          return false;
        }
        // Not rendered at all — nothing announces it either. `getClientRects`
        // rather than `offsetParent`, which is null for any `position: fixed`
        // element: a full-screen backdrop or modal button would otherwise be
        // skipped, and that is exactly where an unnamed control hides.
        return element.getClientRects().length > 0;
      })
      .filter((element) => accessibleName(element) === "")
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        near: textOf(element.closest("li, div, section, form, header")).slice(
          0,
          120,
        ),
      }));
  });
}
