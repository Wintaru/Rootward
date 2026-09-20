import type { GenerationBand } from "@/lib/tree/generation-bands";

/**
 * Imperative SVG overlay for the generation bands (SPEC §8.2, issues #22, #78).
 *
 * Two layers, because they must move differently:
 *
 * - **Fills** live inside `family-chart`'s zoom layer — the `svg .view` group
 *   the library applies its pan/zoom transform to — so they track the cards
 *   with no per-frame sync. The overlay `<g>` is inserted as that group's first
 *   child, so it paints behind the link paths and the cards. Each band is a
 *   `<g>` translated to the band's top edge; a re-layout re-runs
 *   {@link renderGenerationBands} and the CSS transition on the `<g>` transform
 *   and the fill height carries the bands to their new rows alongside the card
 *   animation.
 * - **Labels** sit in a second `<g>` directly under the `<svg>`, outside the
 *   zoom transform, pinned at {@link LABEL_X} from the viewport's left edge so
 *   they stay in view however far the tree is panned or zoomed (#78) — the
 *   HTML card layer sits above the `<svg>`, so a card dragged across the rail
 *   covers them, which is the accepted trade for not touching that layer. Their
 *   `y` is re-read from each fill's on-screen top ({@link syncBandLabels}) —
 *   a `getBoundingClientRect` on the fill gives the position mid-transition
 *   and mid-zoom alike, so one read covers both animations without parsing
 *   the library's transform. {@link observeZoom} keeps the labels in step
 *   with pan/zoom; the render call keeps them in step with a re-layout.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Half-width of the full-bleed fill rect, in layout units. The chart never
 * spans anything close to this, so the band reads as edge-to-edge at any pan.
 */
const BAND_HALF_WIDTH = 100_000;

/** Viewport `x` of the row labels (#78): a fixed left rail, not the cards. */
const LABEL_X = 36;

/**
 * Text baselines measured down from the band's top edge. Sized for the
 * `13px` / `17px` title and `12px` range in `family-tree.css` — keep in step.
 */
const TITLE_BASELINE_Y = 24;
const RANGE_BASELINE_Y = 42;
/** Height the two text lines need; a label stops sliding this far above a
 * band's bottom edge, so it never sits over the next row. */
const LABEL_BLOCK_HEIGHT = 50;

/** How long after a zoom mutation the labels keep re-syncing, in ms. One
 * frame would do; a little slack covers a mutation that lands mid-frame. */
const ZOOM_SYNC_MS = 50;

export interface RenderBandsOptions {
  /** Transition duration for the band move, matched to the card animation. */
  readonly transitionMs: number;
}

export function renderGenerationBands(
  container: HTMLElement,
  viewEl: SVGGElement,
  bands: readonly GenerationBand[],
  options: RenderBandsOptions,
): void {
  const fills = ensureGroup(viewEl, "rw-gen-bands", "first");
  const svg = viewEl.ownerSVGElement;
  const labels =
    svg === null ? null : ensureGroup(svg, "rw-gen-labels", "last");
  const keep = new Set<string>();

  for (const band of bands) {
    const key = String(band.generation);
    keep.add(key);
    positionFill(ensureFillRow(fills, key), band, options);
    if (labels !== null) {
      fillLabelRow(ensureLabelRow(labels, key), band);
    }
  }

  pruneRows(fills, keep);
  if (labels !== null) {
    pruneRows(labels, keep);
  }

  // The fills glide to their new rows over `transitionMs`; keep the labels
  // glued to them for the duration, plus one frame for the final position.
  scheduleLabelSync(container, options.transitionMs + ZOOM_SYNC_MS);
}

/** Drop the overlay entirely — used when a re-layout leaves no nodes. */
export function removeGenerationBands(viewEl: SVGGElement): void {
  viewEl.querySelector(":scope > .rw-gen-bands")?.remove();
  viewEl.ownerSVGElement?.querySelector(":scope > .rw-gen-labels")?.remove();
}

/**
 * Re-sync the labels whenever `family-chart` moves its zoom layer. The library
 * writes the pan/zoom as an inline `transform` style on `svg .view` (one write
 * per zoom event, including each frame of its own re-centre transition), so an
 * attribute observer on that element is a complete, public signal. Returns a
 * disposer for the chart's teardown.
 */
export function observeZoom(container: HTMLElement): () => void {
  const view = container.querySelector<SVGGElement>("svg .view");
  if (view === null) {
    return () => {};
  }
  const observer = new MutationObserver(() => {
    scheduleLabelSync(container, ZOOM_SYNC_MS);
  });
  observer.observe(view, { attributes: true, attributeFilter: ["style"] });
  return () => {
    observer.disconnect();
    const pending = syncLoops.get(container);
    if (pending !== undefined) {
      cancelAnimationFrame(pending.rafId);
      syncLoops.delete(container);
    }
  };
}

interface SyncLoop {
  deadline: number;
  rafId: number;
}

/** One requestAnimationFrame loop per container, extended by each caller. */
const syncLoops = new WeakMap<HTMLElement, SyncLoop>();

function scheduleLabelSync(container: HTMLElement, durationMs: number): void {
  const deadline = performance.now() + durationMs;
  const running = syncLoops.get(container);
  if (running !== undefined) {
    running.deadline = Math.max(running.deadline, deadline);
    return;
  }
  const loop: SyncLoop = { deadline, rafId: 0 };
  const tick = () => {
    syncBandLabels(container);
    if (performance.now() < loop.deadline) {
      loop.rafId = requestAnimationFrame(tick);
    } else {
      syncLoops.delete(container);
    }
  };
  loop.rafId = requestAnimationFrame(tick);
  syncLoops.set(container, loop);
}

/**
 * Place each label row at its fill's current on-screen top — clamped so a
 * band that runs past the viewport's top edge keeps its label pinned at that
 * edge (sticky) for as long as any of the band is visible.
 */
function syncBandLabels(container: HTMLElement): void {
  const svg = container.querySelector<SVGSVGElement>("svg.main_svg");
  if (svg === null) {
    return;
  }
  const svgTop = svg.getBoundingClientRect().top;
  const fills = svg.querySelectorAll<SVGGElement>(
    ".rw-gen-bands > .rw-gen-band",
  );
  // Read every position first, then write — a write between reads would
  // force a fresh layout for each band on every frame.
  const placements: { readonly labelRow: SVGGElement; readonly y: number }[] =
    [];
  for (const fillRow of fills) {
    const key = fillRow.getAttribute("data-generation");
    const rect = fillRow.querySelector<SVGRectElement>(".rw-gen-band__fill");
    const labelRow =
      key === null
        ? null
        : svg.querySelector<SVGGElement>(
            `.rw-gen-labels > [data-generation="${key}"]`,
          );
    if (rect === null || labelRow === null) {
      continue;
    }
    const bounds = rect.getBoundingClientRect();
    const top = bounds.top - svgTop;
    const lowest = Math.max(top, bounds.bottom - svgTop - LABEL_BLOCK_HEIGHT);
    placements.push({ labelRow, y: Math.min(Math.max(top, 0), lowest) });
  }
  for (const { labelRow, y } of placements) {
    labelRow.setAttribute("transform", `translate(${LABEL_X} ${y})`);
  }
}

function ensureGroup(
  parent: SVGElement,
  className: string,
  place: "first" | "last",
): SVGGElement {
  const existing = parent.querySelector<SVGGElement>(`:scope > .${className}`);
  if (existing !== null) {
    return existing;
  }
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", className);
  if (place === "first") {
    parent.insertBefore(group, parent.firstChild);
  } else {
    parent.append(group);
  }
  return group;
}

function pruneRows(group: SVGGElement, keep: ReadonlySet<string>): void {
  for (const child of [...group.children]) {
    const key = child.getAttribute("data-generation");
    if (key === null || !keep.has(key)) {
      child.remove();
    }
  }
}

function ensureFillRow(group: SVGGElement, key: string): SVGGElement {
  const existing = group.querySelector<SVGGElement>(
    `:scope > [data-generation="${key}"]`,
  );
  if (existing !== null) {
    return existing;
  }

  const row = document.createElementNS(SVG_NS, "g");
  row.setAttribute("data-generation", key);
  row.setAttribute("class", "rw-gen-band");

  const fill = document.createElementNS(SVG_NS, "rect");
  fill.setAttribute("class", "rw-gen-band__fill");
  fill.setAttribute("x", String(-BAND_HALF_WIDTH));
  fill.setAttribute("width", String(BAND_HALF_WIDTH * 2));
  fill.setAttribute("y", "0");
  row.append(fill);

  group.append(row);
  return row;
}

function ensureLabelRow(group: SVGGElement, key: string): SVGGElement {
  const existing = group.querySelector<SVGGElement>(
    `:scope > [data-generation="${key}"]`,
  );
  if (existing !== null) {
    return existing;
  }

  const row = document.createElementNS(SVG_NS, "g");
  row.setAttribute("data-generation", key);
  row.setAttribute("class", "rw-gen-label");

  const title = document.createElementNS(SVG_NS, "text");
  title.setAttribute("class", "rw-gen-label__title");
  title.setAttribute("y", String(TITLE_BASELINE_Y));
  row.append(title);

  const range = document.createElementNS(SVG_NS, "text");
  range.setAttribute("class", "rw-gen-label__range");
  range.setAttribute("y", String(RANGE_BASELINE_Y));
  row.append(range);

  group.append(row);
  return row;
}

function positionFill(
  row: SVGGElement,
  band: GenerationBand,
  options: RenderBandsOptions,
): void {
  const height = Math.max(0, band.bottom - band.top);
  const transition = `${options.transitionMs}ms ease`;

  row.style.transition = `transform ${transition}`;
  row.style.transform = `translate(0px, ${band.top}px)`;
  // Parity keyed on the generation, not row order, so a row keeps its shade
  // when the visible set shifts on a re-centre.
  row.classList.toggle("rw-gen-band--alt", Math.abs(band.generation) % 2 === 1);

  const fill = row.querySelector<SVGRectElement>(".rw-gen-band__fill");
  if (fill !== null) {
    fill.style.transition = `height ${transition}`;
    fill.style.height = `${height}px`;
  }
}

function fillLabelRow(row: SVGGElement, band: GenerationBand): void {
  setText(row, ".rw-gen-label__title", band.label);
  setText(row, ".rw-gen-label__range", band.yearRange);
}

function setText(row: SVGGElement, selector: string, text: string): void {
  const el = row.querySelector<SVGTextElement>(selector);
  if (el !== null) {
    el.textContent = text;
  }
}
