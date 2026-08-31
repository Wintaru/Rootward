import type { GenerationBand } from "@/lib/tree/generation-bands";

/**
 * Imperative SVG overlay for the generation bands (SPEC §8.2, issue #22).
 *
 * The bands live inside `family-chart`'s zoom layer — the `svg .view` group the
 * library applies its pan/zoom transform to — so they track the cards with no
 * per-frame sync. The overlay `<g>` is inserted as that group's first child, so
 * it paints behind the link paths and the cards. Each band is a `<g>` translated
 * to the band's top edge; a re-layout re-runs {@link renderGenerationBands} and
 * the CSS transition on the `<g>` transform and the fill height carries the
 * bands to their new rows alongside the card animation.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Half-width of the full-bleed fill rect, in layout units. The chart never
 * spans anything close to this, so the band reads as edge-to-edge at any pan.
 */
const BAND_HALF_WIDTH = 100_000;

/**
 * Text baselines measured down from the band's top edge. Sized for the
 * `13px` label / `11px` range in `family-tree.css` — keep them in step.
 */
const LABEL_BASELINE_Y = 22;
const RANGE_BASELINE_Y = 39;

export interface RenderBandsOptions {
  /** Transition duration for the band move, matched to the card animation. */
  readonly transitionMs: number;
  /** Layout `x` the row labels are right-aligned to (just left of the cards). */
  readonly labelX: number;
}

export function renderGenerationBands(
  viewEl: SVGGElement,
  bands: readonly GenerationBand[],
  options: RenderBandsOptions,
): void {
  const group = ensureGroup(viewEl);
  const keep = new Set<string>();

  for (const band of bands) {
    const key = String(band.generation);
    keep.add(key);
    positionRow(ensureRow(group, key), band, options);
  }

  for (const child of [...group.children]) {
    const key = child.getAttribute("data-generation");
    if (key === null || !keep.has(key)) {
      child.remove();
    }
  }
}

/** Drop the overlay entirely — used when a re-layout leaves no nodes. */
export function removeGenerationBands(viewEl: SVGGElement): void {
  viewEl.querySelector(":scope > .rw-gen-bands")?.remove();
}

function ensureGroup(viewEl: SVGGElement): SVGGElement {
  const existing = viewEl.querySelector<SVGGElement>(":scope > .rw-gen-bands");
  if (existing !== null) {
    return existing;
  }
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "rw-gen-bands");
  viewEl.insertBefore(group, viewEl.firstChild);
  return group;
}

function ensureRow(group: SVGGElement, key: string): SVGGElement {
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

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "rw-gen-band__label");
  label.setAttribute("y", String(LABEL_BASELINE_Y));
  row.append(label);

  const range = document.createElementNS(SVG_NS, "text");
  range.setAttribute("class", "rw-gen-band__range");
  range.setAttribute("y", String(RANGE_BASELINE_Y));
  row.append(range);

  group.append(row);
  return row;
}

function positionRow(
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

  setText(row, ".rw-gen-band__label", band.label, options.labelX);
  setText(row, ".rw-gen-band__range", band.yearRange, options.labelX);
}

function setText(
  row: SVGGElement,
  selector: string,
  text: string,
  x: number,
): void {
  const el = row.querySelector<SVGTextElement>(selector);
  if (el === null) {
    return;
  }
  el.textContent = text;
  el.setAttribute("x", String(x));
}
