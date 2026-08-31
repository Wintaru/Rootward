/**
 * Generation bands for the tree view (SPEC §8.2, issue #22).
 *
 * `family-chart` lays every person in one generation out on a shared vertical
 * (`y`) coordinate — ancestors above the focus (smaller `y`), descendants below.
 * A band is one of those rows drawn as a horizontal strip behind the cards,
 * labelled with the row's generation relative to the focus and the birth-year
 * span of the people on it.
 *
 * This module is pure. `FamilyTree` reads the laid-out node positions off the
 * `family-chart` store after every update and hands them here; the returned
 * bands drive an SVG overlay inside the chart's zoom layer, so they pan, zoom,
 * and animate with the cards for free.
 */

/** One laid-out node, reduced to the fields a band needs. */
export interface LaidOutNode {
  /**
   * Vertical centre of the card in layout coordinates — `family-chart` positions
   * a card by its centre (`translate(-50%, -50%)`).
   */
  readonly y: number;
  /** Birth year, when known — feeds the band's year range. */
  readonly birthYear: number | null;
}

export interface GenerationBandsOptions {
  /** `y` (card centre) of the focus card — the row it sits on is generation 0. */
  readonly focusY: number;
  /** Card height in layout units (`family-chart` `setCardDim().h`). */
  readonly cardHeight: number;
  /**
   * Row-to-row spacing (`family-chart` `setCardYSpacing`). Sets the outer edge
   * of the first and last band, where there is no neighbour to meet halfway.
   */
  readonly rowSpacing: number;
  /**
   * Rows within this many layout units of each other are one generation.
   * Absorbs sub-pixel `y` drift between a person and a spouse on the same row.
   */
  readonly rowTolerance?: number;
}

export interface GenerationBand {
  /** Signed generation: 0 focus, positive up (ancestors), negative down. */
  readonly generation: number;
  /** `Root Generation` · `Generation 2` · `Generation −1`. */
  readonly label: string;
  /** Birth-year span of the people on the row: `1806–1874` · `1912` · `""`. */
  readonly yearRange: string;
  /** Band bounds in layout coordinates, `top` above `bottom` on the screen axis. */
  readonly top: number;
  readonly bottom: number;
}

/**
 * The laid-out tree reduced to what {@link computeGenerationBands} needs, plus
 * the anchor points the overlay uses. Split out from `FamilyTree` so the
 * defensive parsing of `family-chart`'s node shape is unit-tested — the library
 * can synthesise its own nodes, so every field is read as `unknown`.
 */
export interface LaidOutTree {
  readonly nodes: readonly LaidOutNode[];
  /** `y` of the focus card, or `0` when the main node is not in the tree. */
  readonly focusY: number;
  /** Smallest card-centre `x` across the tree, or `null` when none has one. */
  readonly leftmostX: number | null;
}

/**
 * Pull the band inputs out of a `family-chart` tree-data array. A non-array
 * input, an `exiting` node (animating out on a re-centre), or a node with a
 * non-numeric `y` is skipped rather than trusted.
 */
export function readLaidOutTree(
  treeData: unknown,
  mainId: string,
): LaidOutTree {
  const nodes: LaidOutNode[] = [];
  let focusY = 0;
  let leftmostX: number | null = null;

  if (!Array.isArray(treeData)) {
    return { nodes, focusY, leftmostX };
  }

  for (const entry of treeData as readonly unknown[]) {
    const node = entry as {
      x?: unknown;
      y?: unknown;
      exiting?: unknown;
      data?: { id?: unknown; data?: { birthYear?: unknown } };
    };
    if (node.exiting === true || typeof node.y !== "number") {
      continue;
    }
    const birthYear = node.data?.data?.birthYear;
    nodes.push({
      y: node.y,
      birthYear: typeof birthYear === "number" ? birthYear : null,
    });
    if (
      typeof node.x === "number" &&
      (leftmostX === null || node.x < leftmostX)
    ) {
      leftmostX = node.x;
    }
    if (node.data?.id === mainId) {
      focusY = node.y;
    }
  }

  return { nodes, focusY, leftmostX };
}

/** U+2212, the real minus sign — not the hyphen-minus. */
const MINUS_SIGN = "−";
/** U+2013, en dash — the range separator. */
const EN_DASH = "–";
const DEFAULT_ROW_TOLERANCE = 1;

/**
 * Group the laid-out nodes into generation rows and describe each as a band.
 * Rows are ordered top-to-bottom; the one nearest
 * {@link GenerationBandsOptions.focusY} is generation 0.
 */
export function computeGenerationBands(
  nodes: readonly LaidOutNode[],
  options: GenerationBandsOptions,
): readonly GenerationBand[] {
  const { focusY, cardHeight, rowSpacing } = options;
  const tolerance = options.rowTolerance ?? DEFAULT_ROW_TOLERANCE;

  const rows = groupIntoRows(nodes, tolerance);
  if (rows.length === 0) {
    return [];
  }

  const focusIndex = nearestRowIndex(rows, focusY);
  const halfCard = cardHeight / 2;
  const outerMargin = (rowSpacing - cardHeight) / 2;

  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const next = rows[index + 1];
    // Between two rows the boundary is the midpoint of their centres; the first
    // and last rows fall back to half a row gap past the card edge.
    const top =
      previous === undefined
        ? row.y - halfCard - outerMargin
        : (previous.y + row.y) / 2;
    const bottom =
      next === undefined
        ? row.y + halfCard + outerMargin
        : (row.y + next.y) / 2;

    const generation = focusIndex - index;
    return {
      generation,
      label: bandLabel(generation),
      yearRange: yearRange(row.birthYears),
      top,
      bottom,
    };
  });
}

interface Row {
  /** Mean `y` of the cards on the row. */
  readonly y: number;
  readonly birthYears: readonly number[];
}

/**
 * Sort by `y` and walk once, starting a new row whenever the gap to the
 * previous card exceeds the tolerance. Real generations sit `rowSpacing` apart,
 * so any reasonable tolerance separates them cleanly.
 */
function groupIntoRows(
  nodes: readonly LaidOutNode[],
  tolerance: number,
): Row[] {
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  const rows: { ys: number[]; birthYears: number[] }[] = [];

  for (const node of sorted) {
    const current = rows[rows.length - 1];
    const lastY = current?.ys[current.ys.length - 1];
    if (
      current !== undefined &&
      lastY !== undefined &&
      node.y - lastY <= tolerance
    ) {
      current.ys.push(node.y);
      if (node.birthYear !== null) {
        current.birthYears.push(node.birthYear);
      }
    } else {
      rows.push({
        ys: [node.y],
        birthYears: node.birthYear === null ? [] : [node.birthYear],
      });
    }
  }

  return rows.map((row) => ({
    y: row.ys.reduce((sum, y) => sum + y, 0) / row.ys.length,
    birthYears: row.birthYears,
  }));
}

function nearestRowIndex(rows: readonly Row[], y: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const distance = Math.abs(row.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function bandLabel(generation: number): string {
  if (generation === 0) {
    return "Root Generation";
  }
  if (generation > 0) {
    return `Generation ${generation}`;
  }
  return `Generation ${MINUS_SIGN}${Math.abs(generation)}`;
}

function yearRange(birthYears: readonly number[]): string {
  if (birthYears.length === 0) {
    return "";
  }
  const earliest = Math.min(...birthYears);
  const latest = Math.max(...birthYears);
  return earliest === latest ? `${earliest}` : `${earliest}${EN_DASH}${latest}`;
}
