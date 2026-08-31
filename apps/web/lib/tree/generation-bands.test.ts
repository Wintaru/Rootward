import { describe, expect, it } from "vitest";

import {
  computeGenerationBands,
  type GenerationBandsOptions,
  type LaidOutNode,
  readLaidOutTree,
} from "./generation-bands";

const OPTIONS: GenerationBandsOptions = {
  focusY: 0,
  cardHeight: 80,
  rowSpacing: 150,
};

function node(y: number, birthYear: number | null = null): LaidOutNode {
  return { y, birthYear };
}

describe("computeGenerationBands", () => {
  it("returns nothing for an empty tree", () => {
    expect(computeGenerationBands([], OPTIONS)).toEqual([]);
  });

  it("indexes rows relative to the focus row: up positive, down negative", () => {
    const bands = computeGenerationBands(
      [node(-150), node(0), node(150)],
      OPTIONS,
    );

    expect(bands.map((band) => band.generation)).toEqual([1, 0, -1]);
    expect(bands.map((band) => band.label)).toEqual([
      "Generation 1",
      "Root Generation",
      "Generation −1",
    ]);
  });

  it("labels deeper ancestor rows and uses the U+2212 minus for descendants", () => {
    const bands = computeGenerationBands(
      [node(-300), node(-150), node(0), node(150)],
      { ...OPTIONS, focusY: 0 },
    );

    expect(bands.map((band) => band.label)).toEqual([
      "Generation 2",
      "Generation 1",
      "Root Generation",
      "Generation −1",
    ]);
    // The descendant label carries the real minus sign, not a hyphen-minus.
    expect(bands[3]?.label.includes("−")).toBe(true);
    expect(bands[3]?.label.includes("-")).toBe(false);
  });

  it("treats the row nearest focusY as generation 0 even when it is the top row", () => {
    const bands = computeGenerationBands([node(-150), node(0), node(150)], {
      ...OPTIONS,
      focusY: -150,
    });

    expect(bands.map((band) => band.generation)).toEqual([0, -1, -2]);
  });

  it("snaps focusY to the closest row", () => {
    const bands = computeGenerationBands([node(0), node(150)], {
      ...OPTIONS,
      focusY: 40,
    });

    expect(bands.map((band) => band.generation)).toEqual([0, -1]);
  });

  it("tiles the canvas: adjacent bands share an edge, outer edges clear the card", () => {
    const [top, middle, bottom] = computeGenerationBands(
      [node(-150), node(0), node(150)],
      OPTIONS,
    );

    // halfCard 40, outerMargin (150 - 80) / 2 = 35.
    expect(top?.top).toBe(-150 - 40 - 35);
    expect(top?.bottom).toBe(-75);
    expect(middle?.top).toBe(-75);
    expect(middle?.bottom).toBe(75);
    expect(bottom?.top).toBe(75);
    expect(bottom?.bottom).toBe(150 + 40 + 35);
  });

  it("reports the birth-year span of the people on the row", () => {
    const bands = computeGenerationBands(
      [node(-150, 1798), node(-150, 1805), node(0, 1830), node(150, null)],
      OPTIONS,
    );

    expect(bands[0]?.yearRange).toBe("1798–1805");
    expect(bands[1]?.yearRange).toBe("1830");
    expect(bands[2]?.yearRange).toBe("");
  });

  it("uses a U+2013 en dash between the earliest and latest year", () => {
    const [band] = computeGenerationBands(
      [node(0, 1900), node(0, 1912)],
      OPTIONS,
    );

    expect(band?.yearRange).toBe("1900–1912");
  });

  it("clusters a spouse sitting a sub-pixel off its partner into one row", () => {
    const bands = computeGenerationBands(
      [node(0, 1900), node(0.5, 1902), node(150, 1928)],
      OPTIONS,
    );

    expect(bands).toHaveLength(2);
    expect(bands[0]?.generation).toBe(0);
    expect(bands[0]?.yearRange).toBe("1900–1902");
  });

  it("keeps rows separate when the gap exceeds the tolerance", () => {
    const bands = computeGenerationBands([node(0), node(3), node(150)], {
      ...OPTIONS,
      rowTolerance: 1,
    });

    expect(bands).toHaveLength(3);
  });
});

/** A `family-chart` tree-data node, shaped as the library hands it over. */
function treeNode(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    x: 0,
    y: 0,
    data: { id: "p", data: { birthYear: 1900 } },
    ...overrides,
  };
}

describe("readLaidOutTree", () => {
  it("returns empty inputs for a non-array tree", () => {
    expect(readLaidOutTree(undefined, "p")).toEqual({
      nodes: [],
      focusY: 0,
      leftmostX: null,
    });
    expect(readLaidOutTree({ data: "oops" }, "p").nodes).toEqual([]);
  });

  it("reduces each node to its y and birth year", () => {
    const { nodes } = readLaidOutTree(
      [
        treeNode({ y: -150, data: { id: "a", data: { birthYear: 1801 } } }),
        treeNode({ y: 0, data: { id: "b", data: {} } }),
      ],
      "b",
    );

    expect(nodes).toEqual([
      { y: -150, birthYear: 1801 },
      { y: 0, birthYear: null },
    ]);
  });

  it("skips exiting nodes and nodes with a non-numeric y", () => {
    const { nodes } = readLaidOutTree(
      [
        treeNode({ y: 0 }),
        treeNode({ y: 150, exiting: true }),
        treeNode({ y: "nope" }),
      ],
      "p",
    );

    expect(nodes).toHaveLength(1);
  });

  it("takes focusY from the node matching mainId, 0 when absent", () => {
    const rows = [
      treeNode({ y: -150, data: { id: "a", data: {} } }),
      treeNode({ y: 90, data: { id: "b", data: {} } }),
    ];

    expect(readLaidOutTree(rows, "b").focusY).toBe(90);
    expect(readLaidOutTree(rows, "missing").focusY).toBe(0);
  });

  it("reports the smallest card-centre x, or null when no node has one", () => {
    expect(
      readLaidOutTree(
        [treeNode({ x: 40 }), treeNode({ x: -260 }), treeNode({ x: 10 })],
        "p",
      ).leftmostX,
    ).toBe(-260);

    expect(readLaidOutTree([treeNode({ x: "n/a" })], "p").leftmostX).toBeNull();
  });
});
