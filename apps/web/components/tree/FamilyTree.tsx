"use client";

import { createChart } from "family-chart";
import { useEffect, useRef } from "react";

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

interface FamilyTreeProps {
  readonly tree: FamilyChartTree;
}

/**
 * The `family-chart` hourglass view (SPEC §8.2). `family-chart` is a d3
 * renderer, not a React one — it owns a DOM subtree — so this component is a
 * thin shell: a container ref, and one effect that builds the chart and tears
 * it down. All data shaping already happened in `toFamilyChartData` on the
 * server; re-centring on click stays the library's built-in for now
 * (`router.push` navigation is issue #23).
 *
 * A repeated ancestor (pedigree collapse) is drawn once per path, each copy
 * carrying a `×N` badge. `family-chart`'s `setDuplicateBranchToggle` would add a
 * collapse control but it reaches into a `.card-inner` element that a fully
 * custom card does not have and throws — so it is left off here.
 */
export function FamilyTree({ tree }: FamilyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const chart = createChart(container, [...tree.data])
      .setTransitionTime(TRANSITION_MS)
      .setCardXSpacing(CARD_X_SPACING)
      .setCardYSpacing(CARD_Y_SPACING)
      .setOrientationVertical()
      // A missing partner means "outside the fetched neighbourhood", not
      // "unknown" — so no "add spouse" placeholder cards.
      .setSingleParentEmptyCard(false);

    chart
      .setCardHtml()
      .setCardDim({ w: CARD_WIDTH, h: CARD_HEIGHT })
      .setMiniTree(false)
      .setCardInnerHtmlCreator((node) =>
        personCardHtml(cardDataOf(node), duplicateCountOf(node)),
      );

    // Redraw the generation bands after every layout — the initial render and
    // each click re-centre — so they stay aligned with the animated rows.
    chart.setAfterUpdate((props?: AfterUpdateProps) => {
      drawGenerationBands(container, chart, props);
    });

    chart.updateMainId(tree.mainId);
    chart.updateTree({ initial: true, tree_position: "main_to_middle" });

    // `family-chart` has no teardown API. Clearing the container drops the SVG
    // and its d3 zoom behaviour; the library attaches no window-level listeners
    // that would outlive it.
    return () => {
      container.innerHTML = "";
    };
  }, [tree]);

  return <div ref={containerRef} className="f3 rw-tree" />;
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
  chart: ReturnType<typeof createChart>,
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
