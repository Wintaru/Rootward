import { describe, expect, it } from "vitest";

import {
  buildForest,
  child,
  childValue,
  children,
  nodeToRaw,
  tokenizeGedcom,
  type GedcomNode,
} from "./nodes";

/** Narrow away `undefined` in a test without a non-null assertion. */
function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be present`);
  }
  return value;
}

function parse(text: string): GedcomNode[] {
  return buildForest(tokenizeGedcom(text, []), []);
}

describe("tokenizeGedcom", () => {
  it("splits a line into level, xref, tag, and value", () => {
    const warnings: string[] = [];
    const lines = tokenizeGedcom(
      "0 @I1@ INDI\n1 NAME John /Smith/\n",
      warnings,
    );

    expect(warnings).toEqual([]);
    expect(lines).toEqual([
      { level: 0, xref: "@I1@", tag: "INDI", value: null, lineNumber: 1 },
      {
        level: 1,
        xref: null,
        tag: "NAME",
        value: "John /Smith/",
        lineNumber: 2,
      },
    ]);
  });

  it("strips a UTF-8 BOM and tolerates CRLF and blank lines", () => {
    const warnings: string[] = [];
    const lines = tokenizeGedcom("﻿0 HEAD\r\n\r\n1 CHAR UTF-8\r\n", warnings);

    expect(lines.map((line) => line.tag)).toEqual(["HEAD", "CHAR"]);
    expect(warnings).toEqual([]);
  });

  it("skips a malformed line and reports it rather than throwing", () => {
    const warnings: string[] = [];
    const lines = tokenizeGedcom("0 HEAD\nnonsense line\n0 TRLR\n", warnings);

    expect(lines.map((line) => line.tag)).toEqual(["HEAD", "TRLR"]);
    expect(warnings).toHaveLength(1);
    expect(must(warnings[0], "warning")).toContain("Line 2");
  });

  it("uppercases the tag and keeps the value case", () => {
    const line = must(tokenizeGedcom("1 name John", [])[0], "line");
    expect(line.tag).toBe("NAME");
    expect(line.value).toBe("John");
  });
});

describe("buildForest", () => {
  it("nests children by level and marks pointer values", () => {
    const [indi] = parse(
      "0 @I1@ INDI\n1 BIRT\n2 DATE 1 JAN 1900\n1 FAMC @F1@\n",
    );
    const record = must(indi, "INDI record");

    expect(record.tag).toBe("INDI");
    expect(record.xref).toBe("@I1@");
    expect(childValue(must(child(record, "BIRT"), "BIRT"), "DATE")).toBe(
      "1 JAN 1900",
    );

    const famc = must(child(record, "FAMC"), "FAMC");
    expect(famc.pointer).toBe("@F1@");
    expect(famc.value).toBeNull();
  });

  it("merges CONC without a separator and CONT with a newline", () => {
    const [note] = parse(
      "0 @N1@ NOTE First part\n1 CONC  still line one\n1 CONT line two\n",
    );
    expect(must(note, "NOTE").value).toBe(
      "First part still line one\nline two",
    );
  });

  it("attaches to the nearest open ancestor when a level is skipped", () => {
    const [indi] = parse("0 @I1@ INDI\n2 NAME John /Smith/\n");
    expect(childValue(must(indi, "INDI"), "NAME")).toBe("John /Smith/");
  });
});

describe("node accessors", () => {
  it("children returns every match, child returns the first", () => {
    const [indi] = parse("0 @I1@ INDI\n1 NAME A /B/\n1 NAME C /D/\n1 SEX M\n");
    const record = must(indi, "INDI");

    expect(children(record, "NAME")).toHaveLength(2);
    expect(must(child(record, "NAME"), "first NAME").value).toBe("A /B/");
    expect(child(record, "MISSING")).toBeUndefined();
  });

  it("nodeToRaw keeps tag, value, pointer, and nested children", () => {
    const [head] = parse("0 HEAD\n1 _X custom\n2 SOUR @S1@\n");
    const custom = must(child(must(head, "HEAD"), "_X"), "_X");

    expect(nodeToRaw(custom)).toEqual({
      tag: "_X",
      value: "custom",
      children: [{ tag: "SOUR", pointer: "@S1@" }],
    });
  });
});
