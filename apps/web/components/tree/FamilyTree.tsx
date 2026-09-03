"use client";

import { createChart } from "family-chart";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { ExpandRelation, Neighborhood } from "@/lib/db";
import { expandRelatives } from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isUuid } from "@/lib/db/uuid";
import {
  expandedGeneration,
  mergeNeighborhoodFragment,
} from "@/lib/tree/expand-tree";
import {
  computeGenerationBands,
  readLaidOutTree,
} from "@/lib/tree/generation-bands";
import { personCardHtml } from "@/lib/tree/person-card";
import {
  toFamilyChartData,
  type CardSex,
  type FamilyChartPersonData,
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
  readonly neighborhood: Neighborhood;
  /** Generations requested for this render (route defaults + `?up` / `?down`). */
  readonly depth: TreeDepth;
  /** The `tree_settings` defaults — an override links back to a clean URL. */
  readonly depthDefaults: TreeDepth;
}

/**
 * The `family-chart` hourglass view (SPEC §8.2). `family-chart` is a d3
 * renderer, not a React one — it owns a DOM subtree — so this component is a
 * thin shell: it builds the chart once, then feeds each derived `tree` through
 * `updateData` / `updateTree` so the library animates between neighbourhoods
 * instead of the chart being torn down and rebuilt.
 *
 * Clicking a card navigates to `/tree/<id>` (issue #23, decision 28). The page
 * refetches that person's neighbourhood server-side — one query per navigation —
 * and the new payload arrives as the next `neighborhood` prop, which resets the
 * local state below and the sync effect animates to. The focus person is the
 * URL, so the back button walks the history. The depth control does the same
 * with `?up` / `?down`.
 *
 * Expand-in-place (issue #24) is layered on the same mechanism: clicking an
 * affordance fetches one branch via `expandRelatives` and merges it into local
 * state, which flows through the very same derive-then-sync path as a real
 * navigation — the chart never has to know the difference.
 *
 * A repeated ancestor (pedigree collapse) is drawn once per path, each copy
 * carrying a `×N` badge. `family-chart`'s `setDuplicateBranchToggle` would add a
 * collapse control but it reaches into a `.card-inner` element that a fully
 * custom card does not have and throws — so it is left off here.
 */
export function FamilyTree({
  neighborhood: initialNeighborhood,
  depth,
  depthDefaults,
}: FamilyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // The server-fetched neighbourhood plus any expand-in-place additions. A
  // real navigation (new `initialNeighborhood`) resets this — an expanded
  // branch belongs to the current view, not carried across a re-centre. This
  // follows React's "adjusting state when a prop changes" pattern (a render-time
  // comparison, not an effect) rather than an effect that would need a second
  // render to take effect: https://react.dev/learn/you-might-not-need-an-effect
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood);
  const [syncedNeighborhood, setSyncedNeighborhood] =
    useState(initialNeighborhood);
  if (initialNeighborhood !== syncedNeighborhood) {
    setSyncedNeighborhood(initialNeighborhood);
    setNeighborhood(initialNeighborhood);
  }

  // Bumped every time a real navigation resets `neighborhood` above (an
  // effect, not the render body above — a ref may not be written during
  // render). An in-flight expand fetch (below) captures the token it started
  // with and checks it again before merging — if a navigation or depth change
  // landed in the meantime, the fetched fragment belongs to a neighbourhood
  // that no longer exists and must be discarded, not grafted onto the new
  // one. The effect always runs well before any pending fetch's response can
  // arrive, so there is no window where a stale fragment reads a token that
  // has not been bumped yet.
  const navigationTokenRef = useRef(0);
  useEffect(() => {
    navigationTokenRef.current += 1;
  }, [initialNeighborhood]);
  const [isExpanding, setIsExpanding] = useState(false);

  const tree = useMemo(() => toFamilyChartData(neighborhood), [neighborhood]);

  // Kept fresh after every render so the card-click handler (bound once, in the
  // build effect) always navigates with the current focus / depth / router
  // without the chart being rebuilt.
  const navigateRef = useRef<(personId: string) => void>(() => {});
  useEffect(() => {
    navigateRef.current = (personId: string) => {
      // Clicking the focus card is a no-op re-centre. A navigation while an
      // expand fetch is in flight is otherwise allowed (its result is simply
      // discarded when it lands, via `navigationTokenRef`) rather than
      // blocked — `family-chart` sets its own cards' `pointer-events: auto`
      // inline, which wins over the dimming CSS, so clicks reach here
      // regardless; the token check is what actually keeps the merge correct.
      if (personId === tree.mainId) {
        return;
      }
      startNavigation(() => {
        router.push(treeHref(personId, depth, depthDefaults));
      });
    };
  });

  // Same "bound once, kept fresh via a ref" shape as navigateRef — the
  // click-delegation listener that catches an expand-affordance click (in the
  // build effect below) needs somewhere live to read the current neighbourhood
  // from and merge the fetched fragment into. `isExpandingRef` (as opposed to
  // the `isExpanding` state, which only drives the dim/disabled styling) blocks
  // a second expand while one is in flight without waiting on a re-render.
  const expandRef = useRef<
    (target: string, anchor: string, relation: ExpandRelation) => void
  >(() => {});
  const isExpandingRef = useRef(false);
  useEffect(() => {
    expandRef.current = (target, anchor, relation) => {
      if (isExpandingRef.current) {
        return;
      }
      const anchorPerson = neighborhood.persons.find((p) => p.id === anchor);
      if (anchorPerson === undefined) {
        return;
      }
      const generation = expandedGeneration(anchorPerson.generation, relation);
      const tokenAtStart = navigationTokenRef.current;
      isExpandingRef.current = true;
      setIsExpanding(true);
      expandRelatives(supabase, target, relation)
        .then((fragment) => {
          // A navigation or depth change landed while this was in flight —
          // `fragment` is relative to a neighbourhood that no longer exists.
          if (navigationTokenRef.current !== tokenAtStart) {
            return;
          }
          setNeighborhood((prev) =>
            mergeNeighborhoodFragment(prev, fragment, generation),
          );
        })
        .catch((error: unknown) => {
          console.error("expand-in-place failed:", error);
        })
        .finally(() => {
          isExpandingRef.current = false;
          setIsExpanding(false);
        });
    };
  });

  // Mount value only — the build effect below reads it once, then every data
  // change flows through the sync effect.
  const initialTreeRef = useRef(tree);
  const isFirstSync = useRef(true);

  // `depth` as of the last chart sync — lets the sync effect tell whether
  // *this* update actually changed the generation window, rather than a
  // card-click re-centre or an expand-in-place merge (both leave `depth`
  // unchanged). Comparing against the prop itself, instead of a flag set by
  // whichever handler ran, keeps the answer correlated with the update
  // actually being applied: if a card click races ahead of an in-flight
  // depth-stepper fetch and its response is what lands, `depth` on that
  // render is still the pre-change value, so the comparison correctly says
  // "unchanged" instead of inheriting a stale "this was a depth change".
  const lastSyncedDepthRef = useRef(depth);

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
        personCardHtml(
          readNodeId(node) ?? "",
          cardDataOf(node),
          duplicateCountOf(node),
        ),
      );

    // Replace the library's in-window re-centre with a real navigation. The
    // page refetches and the sync effect animates to the result.
    card.setOnCardClick((_event: unknown, node: unknown) => {
      const personId = readNodeId(node);
      if (personId !== null) {
        navigateRef.current(personId);
      }
    });

    // Intercept an expand-in-place click (issue #24) before `setOnCardClick`'s
    // handler — bound above, directly on the card element — can fire and
    // navigate instead. That handler runs in the bubble phase during the
    // click's target phase, which happens *before* a capture-phase listener on
    // an ancestor would otherwise see the bubble; running this one in the
    // capture phase is what gets it there first. `signal` ties the listener's
    // lifetime to this effect so a StrictMode remount does not double-bind it.
    const expandClickController = new AbortController();
    container.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const button = target.closest<HTMLElement>("[data-expand-relation]");
        if (button === null) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        const { expandRelation, expandTarget, expandAnchor } = button.dataset;
        if (
          expandTarget === undefined ||
          expandAnchor === undefined ||
          !isExpandRelation(expandRelation)
        ) {
          return;
        }
        expandRef.current(expandTarget, expandAnchor, expandRelation);
      },
      { capture: true, signal: expandClickController.signal },
    );

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
      expandClickController.abort();
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
      lastSyncedDepthRef.current = depth;
      return;
    }
    // A depth-stepper change refits the whole tree — widening or narrowing
    // the window can bring a generation into or out of view that the current
    // pan/zoom does not account for. A card-click re-centre or an
    // expand-in-place merge leaves `depth` unchanged, so both keep the
    // library's default: re-centre the main card at the current zoom level.
    const depthChanged =
      depth.up !== lastSyncedDepthRef.current.up ||
      depth.down !== lastSyncedDepthRef.current.down;
    chart.updateData([...tree.data]);
    chart.updateMainId(tree.mainId);
    chart.updateTree({
      tree_position: depthChanged ? "fit" : "main_to_middle",
    });
    lastSyncedDepthRef.current = depth;
  }, [tree, depth]);

  return (
    <div
      className="rw-tree-viewport"
      aria-busy={isNavigating || isExpanding}
      data-navigating={isNavigating}
      data-expanding={isExpanding}
    >
      <div ref={containerRef} className="f3 rw-tree" />
      <TreeDepthControls
        depth={depth}
        depthDefaults={depthDefaults}
        disabled={isNavigating || isExpanding}
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
    // A library-synthesised node never carries these — no expand affordance
    // on a placeholder that is not backed by a real fetched person.
    canExpandUp: raw.canExpandUp === true,
    canExpandDown: raw.canExpandDown === true,
    hiddenPartnerId:
      typeof raw.hiddenPartnerId === "string" ? raw.hiddenPartnerId : null,
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

// `satisfies Record<ExpandRelation, true>` forces this object to name every
// `ExpandRelation` member — add a fourth relation to that type and this line
// fails to compile until it is added here too, so `isExpandRelation` can't
// silently fall behind and start dropping clicks for it.
const EXPAND_RELATIONS = {
  parents: true,
  children: true,
  self: true,
} satisfies Record<ExpandRelation, true>;

/** Type guard for an expand-affordance button's `data-expand-relation`. */
function isExpandRelation(value: string | undefined): value is ExpandRelation {
  return value !== undefined && value in EXPAND_RELATIONS;
}
