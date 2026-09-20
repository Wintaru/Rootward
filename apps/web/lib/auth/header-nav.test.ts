import { describe, expect, it } from "vitest";

import { isActiveHref, resolveHeaderNav } from "./header-nav";

const PERSON_ID = "d0000000-0000-4000-8000-000000000001";

function labels(
  ...args: Parameters<typeof resolveHeaderNav>
): readonly string[] {
  return resolveHeaderNav(...args).map((link) => link.label);
}

describe("resolveHeaderNav", () => {
  it("shows nothing to a visitor with no account row", () => {
    expect(labels({ account: null, personId: null })).toEqual([]);
  });

  it("shows nothing to a pending or suspended account", () => {
    expect(
      labels({
        account: { role: "viewer", status: "pending" },
        personId: null,
      }),
    ).toEqual([]);
    expect(
      labels({
        account: { role: "admin", status: "suspended" },
        personId: PERSON_ID,
      }),
    ).toEqual([]);
  });

  it("shows only Home to an unlinked viewer", () => {
    expect(
      labels({ account: { role: "viewer", status: "active" }, personId: null }),
    ).toEqual(["Home"]);
  });

  it("adds My record for a linked viewer, pointing at their person", () => {
    const links = resolveHeaderNav({
      account: { role: "viewer", status: "active" },
      personId: PERSON_ID,
    });
    expect(links.map((link) => link.label)).toEqual(["Home", "My record"]);
    expect(links[1]?.href).toBe(`/person/${PERSON_ID}`);
  });

  it("adds New person, Import / Export, and Moderation, but not Settings, for a moderator", () => {
    expect(
      labels({
        account: { role: "moderator", status: "active" },
        personId: null,
      }),
    ).toEqual(["Home", "New person", "Import / Export", "Moderation"]);
  });

  it("adds Settings for an admin, after the moderator links", () => {
    expect(
      labels({
        account: { role: "admin", status: "active" },
        personId: PERSON_ID,
      }),
    ).toEqual([
      "Home",
      "My record",
      "New person",
      "Import / Export",
      "Moderation",
      "Settings",
    ]);
  });
});

describe("isActiveHref", () => {
  it("lets Home claim the tree routes and nothing else", () => {
    expect(isActiveHref("/", "/")).toBe(true);
    expect(isActiveHref("/tree", "/")).toBe(true);
    expect(isActiveHref(`/tree/${PERSON_ID}`, "/")).toBe(true);
    expect(isActiveHref("/people", "/")).toBe(false);
    expect(isActiveHref("/treehouse", "/")).toBe(false);
  });

  it("matches a link on itself and its sub-routes only", () => {
    expect(isActiveHref("/moderation", "/moderation")).toBe(true);
    expect(isActiveHref("/moderation?invite=x", "/moderation")).toBe(false);
    expect(isActiveHref("/import", "/import")).toBe(true);
    expect(isActiveHref(`/person/${PERSON_ID}`, `/person/${PERSON_ID}`)).toBe(
      true,
    );
    expect(
      isActiveHref(`/person/${PERSON_ID}/edit`, `/person/${PERSON_ID}`),
    ).toBe(true);
    expect(isActiveHref("/person/new", `/person/${PERSON_ID}`)).toBe(false);
    expect(isActiveHref(`/person/${PERSON_ID}`, "/person/new")).toBe(false);
  });
});
