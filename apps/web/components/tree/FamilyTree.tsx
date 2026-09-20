"use client";

import { createChart, type Datum } from "family-chart";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

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
  type PhotoUrls,
} from "@/lib/tree/to-family-chart";
import { fetchPrimaryPhotoUrls } from "@/app/tree/[personId]/actions";
import {
  MAX_GENERATIONS,
  MIN_GENERATIONS,
  treeHref,
  type TreeDepth,
} from "@/lib/tree/tree-view-params";
import { endedUnionKeys } from "@/lib/tree/ended-unions";
import { markEndedUnionLinks } from "./ended-union-links";
import {
  observeZoom,
  removeGenerationBands,
  renderGenerationBands,
} from "./generation-bands-overlay";

import "family-chart/styles/family-chart.css";
import "./family-tree.css";

/** Milliseconds for the re-centre / layout animation (WAYFINDER decision 23). */
const TRANSITION_MS = 800;

/**
 * How long a single card click waits before it re-centres, so a double-click
 * (open the profile, decision 28 / issue #52) can cancel it. The browser fires
 * `click` twice before `dblclick`; without this grace the first click would
 * already have pushed `/tree/<id>` — one wasted neighbourhood fetch and a
 * history entry the profile then lands on top of. Best effort, not a
 * guarantee: OS double-click thresholds range from ~500 ms (the common
 * default) to several seconds, and a slower double-click degrades to the
 * re-centre push followed by the profile push.
 */
const DOUBLE_CLICK_GRACE_MS = 250;

/**
 * Card box, shared between `setCardDim` and the generation-band geometry
 * (SPEC §8.2, #78). `CARD_WIDTH` / `CARD_HEIGHT` must match `.rw-card` in
 * `family-tree.css`.
 */
const CARD_WIDTH = 212;
const CARD_HEIGHT = 84;
const CARD_X_SPACING = 280;
const CARD_Y_SPACING = 156;

type Chart = ReturnType<typeof createChart>;

interface FamilyTreeProps {
  readonly neighborhood: Neighborhood;
  /** `personId → signed thumb URL` for the persons in `neighborhood` that have
   * a primary photo (issue #105); the rest draw the silhouette. */
  readonly photoUrls: PhotoUrls;
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
 * navigation — the chart never has to know the difference. The photos for the
 * persons it adds come from a second, server-side call (`fetchPrimaryPhotoUrls`
 * — a signed URL cannot be minted in the browser); a failure there is logged
 * and the new cards fall back to the silhouette, the branch still expands.
 *
 * Opening the profile (issue #52, decision 28) is a separate action from the
 * re-centre: the card's icon button and a double-click on the card body both
 * push `/person/<id>`. The icon is intercepted like an expand button; the
 * double-click cancels the single click's pending re-centre.
 *
 * A repeated ancestor (pedigree collapse) is drawn once per path, each copy
 * carrying a `×N` badge. `family-chart`'s `setDuplicateBranchToggle` would add a
 * collapse control but it reaches into a `.card-inner` element that a fully
 * custom card does not have and throws — so it is left off here.
 */
export function FamilyTree({
  neighborhood: initialNeighborhood,
  photoUrls: initialPhotoUrls,
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
  // `photoUrls` rides along: the server-signed set for the initial
  // neighbourhood, widened by each expansion, reset by the same navigation.
  const [neighborhood, setNeighborhood] = useState(initialNeighborhood);
  const [photoUrls, setPhotoUrls] = useState(initialPhotoUrls);
  const [syncedNeighborhood, setSyncedNeighborhood] =
    useState(initialNeighborhood);
  if (initialNeighborhood !== syncedNeighborhood) {
    setSyncedNeighborhood(initialNeighborhood);
    setNeighborhood(initialNeighborhood);
    setPhotoUrls(initialPhotoUrls);
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

  const tree = useMemo(
    () => toFamilyChartData(neighborhood, photoUrls),
    [neighborhood, photoUrls],
  );

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

  // Same shape again for the open-profile action (issue #52): the delegated
  // listeners in the build effect read the current router through this ref.
  const openProfileRef = useRef<(personId: string) => void>(() => {});
  useEffect(() => {
    openProfileRef.current = (personId: string) => {
      startNavigation(() => {
        router.push(`/person/${personId}`);
      });
    };
  });

  // The build effect owns the single-click grace timer (see
  // `DOUBLE_CLICK_GRACE_MS`); this lets the depth stepper, rendered by React
  // outside that effect, cancel a pending re-centre too.
  const cancelPendingRecentreRef = useRef<() => void>(() => {});

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
        .then(async (fragment) => {
          // Only the persons not already on screen need a photo lookup — a
          // fragment can re-list people the window already had.
          const newIds = fragment.persons
            .map((person) => person.id)
            .filter((id) => !neighborhood.persons.some((p) => p.id === id));
          // A navigation or depth change landed while this was in flight —
          // `fragment` is relative to a neighbourhood that no longer exists.
          // Checked before the photo call too, so a doomed fragment does not
          // cost a second round trip.
          if (navigationTokenRef.current !== tokenAtStart) {
            return;
          }
          const fragmentPhotoUrls =
            newIds.length === 0
              ? {}
              : await fetchPrimaryPhotoUrls(newIds).catch(
                  (error: unknown): PhotoUrls => {
                    console.error(
                      "expand-in-place photo lookup failed:",
                      error,
                    );
                    return {};
                  },
                );
          if (navigationTokenRef.current !== tokenAtStart) {
            return;
          }
          setNeighborhood((prev) =>
            mergeNeighborhoodFragment(prev, fragment, generation, {
              anchorId: anchor,
              relation,
            }),
          );
          setPhotoUrls((prev) => ({ ...prev, ...fragmentPhotoUrls }));
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

  // Which couples' spouse links to draw as ended (issue #122). Same "bound
  // once, kept fresh via a ref" shape as navigateRef: the `afterUpdate`
  // callback is registered once in the build effect but must see the current
  // neighbourhood on every later layout.
  const endedUnionKeysRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    endedUnionKeysRef.current = endedUnionKeys(neighborhood.families);
  }, [neighborhood.families]);

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
      .setSingleParentEmptyCard(false)
      // Off by default in family-chart. `get_neighborhood` fetches the focus
      // person's siblings (SPEC §8.2) and `toFamilyChartData` links them to
      // the same parents; without this the layout never places them (#115).
      // The library places a sibling relative to a drawn parent, so with
      // `up=0` (or no recorded parent) the fetched siblings stay undrawn.
      .setShowSiblingsOfMain(true)
      .setSortChildrenFunction(sortChildrenByBirthYear);

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
    // page refetches and the sync effect animates to the result. The
    // navigation is held for `DOUBLE_CLICK_GRACE_MS` so a double-click (open
    // the profile, below) can cancel it; a second single click within the
    // grace simply restarts the wait with the newer card.
    let pendingRecentre: ReturnType<typeof setTimeout> | null = null;
    const cancelPendingRecentre = () => {
      if (pendingRecentre !== null) {
        clearTimeout(pendingRecentre);
        pendingRecentre = null;
      }
    };
    cancelPendingRecentreRef.current = cancelPendingRecentre;
    card.setOnCardClick((_event: unknown, node: unknown) => {
      const personId = readNodeId(node);
      if (personId === null) {
        return;
      }
      cancelPendingRecentre();
      pendingRecentre = setTimeout(() => {
        pendingRecentre = null;
        navigateRef.current(personId);
      }, DOUBLE_CLICK_GRACE_MS);
    });

    // Intercept an expand-in-place click (issue #24) or an open-profile click
    // (issue #52) before `setOnCardClick`'s handler — bound above, directly on
    // the card element — can fire and re-centre instead. That handler runs in
    // the bubble phase during the click's target phase, which happens *before*
    // a capture-phase listener on an ancestor would otherwise see the bubble;
    // running this one in the capture phase is what gets it there first.
    // `signal` ties the listener's lifetime to this effect so a StrictMode
    // remount does not double-bind it.
    const cardActionController = new AbortController();
    container.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const profileButton = target.closest<HTMLElement>(
          "[data-open-profile]",
        );
        if (profileButton !== null) {
          event.stopPropagation();
          event.preventDefault();
          // A card-body click inside the grace must not re-centre on top of
          // the profile push — the later action wins.
          cancelPendingRecentre();
          const personId = profileButton.dataset.openProfile;
          if (personId !== undefined && isUuid(personId)) {
            openProfileRef.current(personId);
          }
          return;
        }
        const button = target.closest<HTMLElement>("[data-expand-relation]");
        if (button === null) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        cancelPendingRecentre();
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
      { capture: true, signal: cardActionController.signal },
    );

    // Double-click on the card body opens the profile (issue #52). Capture
    // phase for the same reason as above, and also because d3-zoom binds its
    // own `dblclick.zoom` on the canvas `family-chart` creates — stopping the
    // event here keeps a double-click anywhere on a card from zooming the
    // chart as well. A double-click that lands on one of the card's buttons
    // is theirs (each click already ran above), not a profile open.
    container.addEventListener(
      "dblclick",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const cardBody = target.closest<HTMLElement>("[data-person-id]");
        if (cardBody === null) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        cancelPendingRecentre();
        if (target.closest("button") !== null) {
          return;
        }
        const personId = cardBody.dataset.personId;
        if (personId !== undefined && isUuid(personId)) {
          openProfileRef.current(personId);
        }
      },
      { capture: true, signal: cardActionController.signal },
    );

    // Redraw the generation bands after every layout — the initial render and
    // each re-centre — so they stay aligned with the animated rows, and tag
    // the spouse links of ended unions (issue #122) while the paths are fresh.
    chart.setAfterUpdate((props?: AfterUpdateProps) => {
      drawGenerationBands(container, chart, props);
      markEndedUnionLinks(container, endedUnionKeysRef.current);
    });

    chart.updateMainId(initial.mainId);
    // Not `initial: true`: in `family-chart` 0.9 that flag makes the first
    // draw shrink-to-fit the whole tree regardless of `tree_position`, which
    // is exactly the illegible all-the-way-out zoom the sync effect below
    // avoids on a depth change. A zero-length non-initial update
    // instead lands centred on the main card at full scale; the only
    // thing given up is the library's staggered card fade-in.
    chart.updateTree({
      initial: false,
      tree_position: "main_to_middle",
      transition_time: 0,
    });
    chartRef.current = chart;
    // The band labels are pinned to the viewport (#78) and follow the
    // library's pan/zoom by observation; the chart's first draw above has
    // already created `svg .view`.
    const stopObservingZoom = observeZoom(container);

    // `family-chart` has no teardown API. Clearing the container drops the SVG
    // and its d3 zoom behaviour; the library attaches no window-level listeners
    // that would outlive it.
    return () => {
      cancelPendingRecentre();
      cancelPendingRecentreRef.current = () => {};
      cardActionController.abort();
      stopObservingZoom();
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
    // Always re-centre the main card at full scale (`main_to_middle` resets
    // the zoom to 1 unless given a `scale`), never
    // shrink-to-fit the whole window (`family-chart`'s `"fit"` position) --
    // a depth-stepper increase on a person with many descendants can pull in
    // dozens of cards, and fitting all of them on screen at once makes every
    // card illegibly small. Manual scroll/pinch zoom (the library's own d3
    // zoom behaviour, set up below) is how someone sees more of a large
    // tree; the stepper no longer forces that zoom-out itself.
    chart.updateData([...tree.data]);
    chart.updateMainId(tree.mainId);
    chart.updateTree({ tree_position: "main_to_middle" });
  }, [tree]);

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
          // A card click still inside its grace would otherwise fire after
          // this replace and push the old depth back.
          cancelPendingRecentreRef.current();
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
 * Generations panel (SPEC §8.2, #78) — the in-session depth override. A
 * `router.replace` per step — the override lives in `?up` / `?down` but does
 * not clutter the focus-person back history (decision 28: the back button
 * walks *focus* history).
 */
function TreeDepthControls({
  depth,
  depthDefaults,
  disabled,
  onChange,
}: TreeDepthControlsProps) {
  // The visible heading is the group's accessible name (one source; the e2e
  // specs select the group by it).
  const headingId = useId();
  return (
    <div className="rw-gen-panel" role="group" aria-labelledby={headingId}>
      <span id={headingId} className="rw-gen-panel__heading">
        Generations shown
      </span>
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
          className="rw-gen-panel__reset"
          disabled={disabled}
          onClick={() => onChange(depthDefaults)}
        >
          Reset to defaults
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
    <div className="rw-gen-panel__stepper">
      <span className="rw-gen-panel__label">{label}</span>
      <button
        type="button"
        className="rw-gen-panel__step"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={disabled || value <= MIN_GENERATIONS}
        onClick={() => onStep(-1)}
      >
        <StepIcon kind="minus" />
      </button>
      <span className="rw-gen-panel__value">{value}</span>
      <button
        type="button"
        className="rw-gen-panel__step"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || value >= MAX_GENERATIONS}
        onClick={() => onStep(1)}
      >
        <StepIcon kind="plus" />
      </button>
    </div>
  );
}

/** Stroke-SVG minus / plus for the steppers; takes the button's `color`. */
function StepIcon({ kind }: { readonly kind: "minus" | "plus" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={kind === "plus" ? "M8 3v10M3 8h10" : "M3 8h10"} />
    </svg>
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

  const { nodes, focusY } = readLaidOutTree(
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

  renderGenerationBands(container, view, bands, {
    transitionMs:
      props?.initial === true ? 0 : (props?.transition_time ?? TRANSITION_MS),
  });
}

const CARD_SEXES: readonly CardSex[] = ["male", "female", "neutral"];

/**
 * family-chart (0.9.0) attaches spouses only to hierarchy nodes on the
 * descendant side (`setupSpouses` skips `is_ancestry`), never walks the
 * spouses of a spouse node it `added` itself, and builds sibling-of-main
 * nodes after that pass. These are its own flags on the tree node it hands
 * the card creator — internals, so a version bump can rename them without a
 * type error. The "Show partner" describe in `e2e/tests/tree-controls.spec.ts`
 * is the guard: re-run it after upgrading.
 */
const SPOUSELESS_LAYOUT_FLAGS: readonly string[] = [
  "is_ancestry",
  "added",
  "sibling",
];

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
  // A partner resolved for a card the layout will not attach spouses to
  // (`SPOUSELESS_LAYOUT_FLAGS`) is merged into the data and never drawn — an
  // ancestor's second marriage is the reported case (#106), a married
  // sibling the other (#115). Offer "Show partner" only where a press draws
  // a card; re-centring on that person makes them the root, where every
  // spouse is drawn.
  const layoutDrawsSpouses = !isLayoutFlagSet(node, SPOUSELESS_LAYOUT_FLAGS);
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
      layoutDrawsSpouses && typeof raw.hiddenPartnerId === "string"
        ? raw.hiddenPartnerId
        : null,
  };
}

/** True when family-chart set any of `flags` to `true` on its tree node. */
function isLayoutFlagSet(node: unknown, flags: readonly string[]): boolean {
  const record = (node ?? {}) as Record<string, unknown>;
  return flags.some((flag) => record[flag] === true);
}

/**
 * Full siblings — the same parent pair — oldest to youngest, left to right.
 * `family_child.sort_order` (the `CHIL` order a GEDCOM file happened to list
 * children in) is not reliably birth order, so this ignores it and sorts by
 * each card's own birth year instead. A child with no recorded birth year
 * sorts after every dated sibling, by id — there is no better guess, and id
 * order is at least stable across re-renders.
 *
 * Wired in via `family-chart`'s own `setSortChildrenFunction` rather than
 * pre-sorting the array `to-family-chart.ts` builds: the library re-derives
 * sibling order itself during layout (interleaving spouses, placing newly
 * added cards, …), so a plain input-order change would not reliably survive
 * that pass — this hook is the library's documented integration point for
 * exactly this.
 *
 * Not global across a blended family: `family-chart` runs its own
 * `sortChildrenWithSpouses` after this comparator, which groups a person's
 * children by which of their partners the child came from before anything
 * else. Birth-year order only holds within one of those groups — a younger
 * child from an earlier marriage can still sort left of an older half-
 * sibling from a later one. Fixing that would mean also ordering the parent's
 * partners chronologically (`setSortSpousesFunction`), not attempted here.
 */
function sortChildrenByBirthYear(a: Datum, b: Datum): number {
  const yearA = birthYearOf(a);
  const yearB = birthYearOf(b);
  if (yearA === null && yearB === null) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (yearA === null) {
    return 1;
  }
  if (yearB === null) {
    return -1;
  }
  return yearA - yearB;
}

function birthYearOf(datum: Datum): number | null {
  const year = (datum.data as Partial<FamilyChartPersonData>).birthYear;
  return typeof year === "number" ? year : null;
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
