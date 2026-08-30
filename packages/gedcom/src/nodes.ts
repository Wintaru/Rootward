/**
 * GEDCOM line grammar and record tree.
 *
 * A GEDCOM file is a flat list of lines, each `LEVEL [@XREF@] TAG [VALUE]`.
 * `tokenizeGedcom` turns the text into {@link GedcomLine} records; `buildForest`
 * folds them into a forest of {@link GedcomNode} records, one tree per level-0
 * record. `CONC` / `CONT` continuation lines are merged into the value of the
 * node they extend, so a caller never sees them.
 *
 * This layer is calendar- and schema-agnostic. The mapping to the Rootward
 * shape lives in `reader.ts`.
 */

/** One physical GEDCOM line, already split into its parts. */
export interface GedcomLine {
  readonly level: number;
  /** Record id for a level-0 line (`@I1@`), else `null`. */
  readonly xref: string | null;
  readonly tag: string;
  /** Text after the tag, or `null` when the line has no value. */
  readonly value: string | null;
  /** 1-based line number in the source, for warnings. */
  readonly lineNumber: number;
}

/** A node in the record tree: a tag with its value and nested sub-tags. */
export interface GedcomNode {
  readonly tag: string;
  /** Record id when this is a level-0 record node (`@I1@`), else `null`. */
  readonly xref: string | null;
  /** The value when it is a cross-reference pointer (`@S1@`), else `null`. */
  readonly pointer: string | null;
  /** The literal value (with `CONC` / `CONT` merged in), else `null`. */
  readonly value: string | null;
  readonly children: readonly GedcomNode[];
}

/** An unmapped sub-tree, kept verbatim for `raw_gedcom` and re-export. */
export interface RawGedcomNode {
  readonly tag: string;
  /** Record id when the node is a level-0 record (`@U1@`), else absent. Kept so
   * the writer can re-emit `0 @U1@ SUBM` rather than a dangling `0 SUBM`. */
  readonly xref?: string;
  readonly value?: string;
  readonly pointer?: string;
  readonly children?: readonly RawGedcomNode[];
}

const BOM = "﻿";
const POINTER_RE = /^@[^@]+@$/;
// LEVEL, optional @XREF@, TAG, optional value. Leading spaces are illegal but
// some real files have them, so the pattern tolerates them.
const LINE_RE = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_.]+)(?:\s(.*))?$/;

function isPointer(value: string): boolean {
  return POINTER_RE.test(value);
}

/**
 * Split GEDCOM text into lines. Unparseable lines are skipped and reported in
 * `warnings` rather than throwing — a malformed line should not lose the file.
 */
export function tokenizeGedcom(text: string, warnings: string[]): GedcomLine[] {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines: GedcomLine[] = [];

  const physical = body.split(/\r\n|\r|\n/);
  for (let i = 0; i < physical.length; i += 1) {
    const rawLine = physical[i] ?? "";
    if (rawLine.trim() === "") {
      continue;
    }

    const match = LINE_RE.exec(rawLine);
    if (match === null) {
      warnings.push(`Line ${i + 1}: not valid GEDCOM, skipped: ${rawLine}`);
      continue;
    }

    const level = Number.parseInt(match[1] ?? "", 10);
    const value = match[4] ?? null;
    lines.push({
      level,
      xref: match[2] ?? null,
      tag: (match[3] ?? "").toUpperCase(),
      value,
      lineNumber: i + 1,
    });
  }

  return lines;
}

interface MutableNode {
  readonly tag: string;
  readonly xref: string | null;
  pointer: string | null;
  value: string | null;
  readonly children: MutableNode[];
}

function freeze(node: MutableNode): GedcomNode {
  return {
    tag: node.tag,
    xref: node.xref,
    pointer: node.pointer,
    value: node.value,
    children: node.children.map(freeze),
  };
}

/**
 * Fold a line list into a forest — one tree per level-0 record. A `CONC` line
 * appends to the open node's value with no separator; `CONT` appends a newline
 * first. Level jumps that skip a level are tolerated: the node attaches to the
 * deepest open ancestor.
 */
export function buildForest(
  lines: readonly GedcomLine[],
  warnings: string[],
): GedcomNode[] {
  const forest: MutableNode[] = [];
  // stack[n] is the currently open node at level n.
  const stack: MutableNode[] = [];

  for (const line of lines) {
    if (line.tag === "CONC" || line.tag === "CONT") {
      // A continuation always follows the line it extends with nothing deeper in
      // between — true for every real serializer — so the deepest open node is
      // the target regardless of the CONC/CONT line's own level.
      const target = stack[stack.length - 1];
      if (target === undefined) {
        warnings.push(`Line ${line.lineNumber}: ${line.tag} with no open node`);
        continue;
      }
      const addition = line.value ?? "";
      const prefix = target.value ?? "";
      target.value =
        line.tag === "CONT" ? `${prefix}\n${addition}` : `${prefix}${addition}`;
      continue;
    }

    const node: MutableNode = {
      tag: line.tag,
      xref: line.xref,
      pointer: line.value !== null && isPointer(line.value) ? line.value : null,
      value: line.value !== null && !isPointer(line.value) ? line.value : null,
      children: [],
    };

    if (line.level === 0) {
      forest.push(node);
      stack.length = 0;
      stack[0] = node;
      continue;
    }

    // Attach to the deepest open node shallower than this line.
    let parentLevel = line.level - 1;
    while (parentLevel > 0 && stack[parentLevel] === undefined) {
      parentLevel -= 1;
    }
    const parent = stack[parentLevel];
    if (parent === undefined) {
      warnings.push(
        `Line ${line.lineNumber}: ${line.tag} has no parent record`,
      );
      continue;
    }

    parent.children.push(node);
    stack.length = line.level + 1;
    stack[line.level] = node;
  }

  return forest.map(freeze);
}

// --- node accessors ---------------------------------------------------------

/** First child with `tag`, or `undefined`. */
export function child(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

/** Every child with `tag`, in file order. */
export function children(node: GedcomNode, tag: string): GedcomNode[] {
  return node.children.filter((c) => c.tag === tag);
}

/** Value of the first child with `tag`, trimmed, or `null`. */
export function childValue(node: GedcomNode, tag: string): string | null {
  const found = child(node, tag);
  const value = found?.value ?? null;
  return value === null ? null : value.trim();
}

/** Pointer of the first child with `tag` (`@S1@`), or `null`. */
export function childPointer(node: GedcomNode, tag: string): string | null {
  return child(node, tag)?.pointer ?? null;
}

/** Serialize a node to the compact `raw_gedcom` shape, sub-tags and all. */
export function nodeToRaw(node: GedcomNode): RawGedcomNode {
  return {
    tag: node.tag,
    ...(node.xref !== null ? { xref: node.xref } : {}),
    ...(node.value !== null ? { value: node.value } : {}),
    ...(node.pointer !== null ? { pointer: node.pointer } : {}),
    ...(node.children.length > 0
      ? { children: node.children.map(nodeToRaw) }
      : {}),
  };
}

/**
 * A `raw_gedcom` copy of a node keeping only its children — for a tag whose
 * value or pointer is already mapped to a structured field but that carries
 * extra sub-tags (`DATE` / `PLAC` with a `MAP`, `ADDR` with a `CITY`, …). The
 * writer re-attaches the extras without a duplicate of the mapped line.
 */
export function rawChildrenOnly(node: GedcomNode): RawGedcomNode {
  return { tag: node.tag, children: node.children.map(nodeToRaw) };
}

/**
 * Every child a reader did not consume, for `raw_gedcom` (decision 4). A tag in
 * `handledMany` is consumed on every occurrence; a tag in `handledOnce` is
 * consumed only the first time it appears, so a repeat still reaches `raw`.
 */
export function unhandledChildren(
  node: GedcomNode,
  handledOnce: readonly string[],
  handledMany: readonly string[] = [],
): RawGedcomNode[] {
  const usedOnce = new Set<string>();
  const raw: RawGedcomNode[] = [];
  for (const sub of node.children) {
    if (handledMany.includes(sub.tag)) {
      continue;
    }
    if (handledOnce.includes(sub.tag) && !usedOnce.has(sub.tag)) {
      usedOnce.add(sub.tag);
      continue;
    }
    raw.push(nodeToRaw(sub));
  }
  return raw;
}
