"use client";

import { createChart } from "family-chart";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { isUuid } from "@/lib/db/uuid";
import {
  computeGenerationBands,
  readLaidOutTree,
} from "@/lib/tree/generation-bands";
import { personCardHtml } from "@/lib/tree/person-card";
import type {
  CardSex,
  FamilyChartPersonData,
  FamilyChartTree,
} from "@/lib/tree/to-family-chart";
import {
  MAX_GENERATIONS,
  MIN_GENERATIONS,
  treeHref,
  type TreeDepth,
} from "@/lib/tree/tree-view-params";
import {
  removeGenerationBands,
  renderGenerationBands,
} from "./generation-bands-overlay";

import "family-chart/styles/family-chart.css";
import "./family-tree.css";

/** Milliseconds for the re-centre / layout animation (WAYFINDER decision 23). */
const TRANSITION_MS = 800;

/**
 * Card box, shared between `setCardDim` and the generation-band geometry
 * (SPEC §8.2). `CARD_WIDTH` / `CARD_HEIGHT` must match `.rw-card` in
 * `family-tree.css`.
 */
const CARD_WIDTH = 190;
const CARD_HEIGHT = 80;
const CARD_X_SPACING = 260;
const CARD_Y_SPACING = 150;
/** Layout gap between a band's left label and the leftmost card on its row. */
const LABEL_GUTTER = 24;

type Chart = ReturnType<typeof createChart>;

interface FamilyTreeProps {
  readonly tree: FamilyChartTree;
  /** Generations requested for this render (route defaults + `?up` / `?down`). */
  readonly depth: TreeDepth;
  /** The `tree_settings` defaults — an override links back to a clean URL. */
  readonly depthDefaults: TreeDepth;
}

/**
 * The `family-chart` hourglass view (SPEC §8.2). `family-chart` is a d3
 * renderer, not a React one — it owns a DOM subtree — so this component is a
 * thin shell: it builds the chart once, then feeds each new `tree` prop through
 * `updateData` / `updateTree` so the library animates between neighbourhoods
 * instead of the chart being torn down and rebuilt.
 *
 * Clicking a card navigates to `/tree/<id>` (issue #23, decision 28). The page
 * refetches that person's neighbourhood server-side — one query per navigation —
 * and the new payload arrives here as the next `tree` prop, which the sync
 * effect animates to. The focus person is the URL, so the back button walks the
 * history. The depth control does the same with `?up` / `?down`.
 *
 * A repeated ancestor (pedigree collapse) is drawn once per path, each copy
 * carrying a `×N` badge. `family-chart`'s `setDuplicateBranchToggle` would add a
 * collapse control but it reaches into a `.card-inner` element that a fully
 * custom card does not have and throws — so it is left off here.
 */
export function FamilyTree({ tree, depth, depthDefaults }: FamilyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();

  // Kept fresh after every render so the card-click handler (bound once, in the
  // build effect) always navigates with the current focus / depth / router
  // without the chart being rebuilt.
  const navigateRef = useRef<(personId: string) => void>(() => {});
  useEffect(() => {
    navigateRef.current = (personId: string) => {
      // Clicking the focus card is a no-op re-centre.
      if (personId === tree.mainId) {
        return;
      }
      startNavigation(() => {
        router.push(treeHref(personId, depth, depthDefaults));
      });
    };
  });

  // Mount value only — the build effect below reads it once, then every data
  // change flows through the sync effect.
  const initialTreeRef = useRef(tree);
  const isFirstSync = useRef(true);

  // Build the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    // A dev-StrictMode remount re-runs this effect; make the sync effect skip
    // its first pass again so it does not re-animate the fresh chart.
    isFirstSync.current = true;

    const initial = initialTreeRef.current;
    const chart = createChart(container, [...initial.data])
      .setTransitionTime(TRANSITION_MS)
      .setCardXSpacing(CARD_X_SPACING)
      .setCardYSpacing(CARD_Y_SPACING)
      .setOrientationVertical()
      // A missing partner means "outside the fetched neighbourhood", not
      // "unknown" — so no "add spouse" placeholder cards.
      .setSingleParentEmptyCard(false);

    const card = chart
      .setCardHtml()
      .setCardDim({ w: CARD_WIDTH, h: CARD_HEIGHT })
      .setMiniTree(false)
      .setCardInnerHtmlCreator((node) =>
        personCardHtml(cardDataOf(node), duplicateCountOf(node)),
      );

    // Replace the library's in-window re-centre with a real navigation. The
    // page refetches and the sync effect animates to the result.
    card.setOnCardClick((_event: unknown, node: unknown) => {
      const personId = readNodeId(node);
      if (personId !== null) {
        navigateRef.current(personId);
      }
    });

    // Redraw the generation bands after every layout — the initial render and
    // each re-centre — so they stay aligned with the animated rows.
    chart.setAfterUpdate((props?: AfterUpdateProps) => {
      drawGenerationBands(container, chart, props);
    });

    chart.updateMainId(initial.mainId);
    chart.updateTree({ initial: true, tree_position: "main_to_middle" });
    chartRef.current = chart;

    // `family-chart` has no teardown API. Clearing the container drops the SVG
    // and its d3 zoom behaviour; the library attaches no window-level listeners
    // that would outlive it.
    return () => {
      container.innerHTML = "";
      chartRef.current = null;
    };
  }, []);

  // Feed each new payload to the live chart so the library animates the diff
  // (nodes entering / exiting as the window shifts). Skips the first run — the
  // build effect above already drew `tree`.
  useEffect(() => {
    const chart = chartRef.current;
    if (chart === null) {
      return;
    }
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    chart.updateData([...tree.data]);
    chart.updateMainId(tree.mainId);
    chart.updateTree({ tree_position: "main_to_middle" });
  }, [tree]);

  return (
    <div
      className="rw-tree-viewport"
      aria-busy={isNavigating}
      data-navigating={isNavigating}
    >
      <div ref={containerRef} className="f3 rw-tree" />
      <TreeDepthControls
        depth={depth}
        depthDefaults={depthDefaults}
        disabled={isNavigating}
        onChange={(next) => {
          startNavigation(() => {
            router.replace(treeHref(tree.mainId, next, depthDefaults));
          });
        }}
      />
    </div>
  );
}

interface TreeDepthControlsProps {
  readonly depth: TreeDepth;
  readonly depthDefaults: TreeDepth;
  readonly disabled: boolean;
  readonly onChange: (next: TreeDepth) => void;
}

/**
 * In-session depth override (SPEC §8.2). A `router.replace` per step — the
 * override lives in `?up` / `?down` but does not clutter the focus-person back
 * history (decision 28: the back button walks *focus* history).
 */
function TreeDepthControls({
  depth,
  depthDefaults,
  disabled,
  onChange,
}: TreeDepthControlsProps) {
  return (
    <div className="rw-tree-depth" role="group" aria-label="Generations shown">
      <DepthStepper
        label="Ancestors"
        value={depth.up}
        disabled={disabled}
        onStep={(delta) => onChange({ ...depth, up: depth.up + delta })}
      />
      <DepthStepper
        label="Descendants"
        value={depth.down}
        disabled={disabled}
        onStep={(delta) => onChange({ ...depth, down: depth.down + delta })}
      />
      {(depth.up !== depthDefaults.up || depth.down !== depthDefaults.down) && (
        <button
          type="button"
          className="rw-tree-depth__reset"
          disabled={disabled}
          onClick={() => onChange(depthDefaults)}
        >
          Reset
        </button>
      )}
    </div>
  );
}

interface DepthStepperProps {
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  readonly onStep: (delta: number) => void;
}

function DepthStepper({ label, value, disabled, onStep }: DepthStepperProps) {
  return (
    <div className="rw-tree-depth__stepper">
      <span className="rw-tree-depth__label">{label}</span>
      <button
        type="button"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={disabled || value <= MIN_GENERATIONS}
        onClick={() => onStep(-1)}
      >
        −
      </button>
      <span className="rw-tree-depth__value">{value}</span>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || value >= MAX_GENERATIONS}
        onClick={() => onStep(1)}
      >
        +
      </button>
    </div>
  );
}

/**
 * The subset of `family-chart`'s post-update payload the band overlay reads.
 * Keys are snake_case to mirror the library payload verbatim.
 */
interface AfterUpdateProps {
  readonly initial?: boolean;
  readonly transition_time?: number;
}

/**
 * Recompute the generation bands from the freshly laid-out tree and repaint the
 * SVG overlay. Runs on `afterUpdate`, so `chart.store.getTree()` holds the final
 * positions the cards are animating towards; the overlay transitions to match.
 */
function drawGenerationBands(
  container: HTMLElement,
  chart: Chart,
  props: AfterUpdateProps | undefined,
): void {
  const view = container.querySelector<SVGGElement>("svg .view");
  if (view === null) {
    return;
  }

  const { nodes, focusY, leftmostX } = readLaidOutTree(
    chart.store.getTree()?.data,
    chart.store.getMainId(),
  );

  if (nodes.length === 0) {
    removeGenerationBands(view);
    return;
  }

  const bands = computeGenerationBands(nodes, {
    focusY,
    cardHeight: CARD_HEIGHT,
    rowSpacing: CARD_Y_SPACING,
  });

  renderGenerationBands(view, bands, {
    transitionMs:
      props?.initial === true ? 0 : (props?.transition_time ?? TRANSITION_MS),
    labelX: (leftmostX ?? 0) - CARD_WIDTH / 2 - LABEL_GUTTER,
  });
}

const CARD_SEXES: readonly CardSex[] = ["male", "female", "neutral"];

/**
 * `family-chart` hands the card creator its own tree node. `node.data.data` is
 * the object we built in `toFamilyChartData`. We control what went in, but the
 * library can also synthesise its own nodes (e.g. a spouse placeholder), so the
 * creator must never throw on a shape it did not expect — one exception blanks
 * the whole render pass. Read defensively and fall back to an empty card.
 */
function cardDataOf(node: unknown): FamilyChartPersonData {
  const raw =
    (node as { data?: { data?: Partial<FamilyChartPersonData> } }).data?.data ??
    {};
  const sex = CARD_SEXES.find((value) => value === raw.sex) ?? "neutral";
  return {
    // "male → M, everyone else → F" — same fold as `toPersonData`.
    gender: raw.gender === "M" ? "M" : "F",
    sex,
    givenName: typeof raw.givenName === "string" ? raw.givenName : "",
    surname: typeof raw.surname === "string" ? raw.surname : "",
    nickname: typeof raw.nickname === "string" ? raw.nickname : "",
    birthYear: typeof raw.birthYear === "number" ? raw.birthYear : null,
    deathYear: typeof raw.deathYear === "number" ? raw.deathYear : null,
    isLiving: typeof raw.isLiving === "boolean" ? raw.isLiving : null,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : null,
  };
}

function duplicateCountOf(node: unknown): number {
  const count = (node as { duplicate?: unknown }).duplicate;
  return typeof count === "number" ? count : 0;
}

/**
 * The person id off a clicked `family-chart` node, or `null` for anything that
 * is not a real person — a library-synthesised placeholder, or a shape the
 * library changes in a future version.
 */
function readNodeId(node: unknown): string | null {
  const id = (node as { data?: { id?: unknown } }).data?.id;
  return typeof id === "string" && isUuid(id) ? id : null;
}
