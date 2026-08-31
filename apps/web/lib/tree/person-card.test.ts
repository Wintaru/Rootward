import { describe, expect, it } from "vitest";

import {
  displayName,
  escapeHtml,
  formatLifespan,
  personCardHtml,
} from "./person-card";
import type { FamilyChartPersonData } from "./to-family-chart";

const PERSON_ID = "10000000-0000-0000-0000-000000000001";
const PARTNER_ID = "10000000-0000-0000-0000-000000000002";

function card(
  overrides: Partial<FamilyChartPersonData> = {},
): FamilyChartPersonData {
  return {
    gender: "M",
    sex: "male",
    givenName: "Samuel",
    surname: "Ashby",
    nickname: "",
    birthYear: 1830,
    deathYear: 1901,
    isLiving: false,
    avatarUrl: null,
    canExpandUp: false,
    canExpandDown: false,
    hiddenPartnerId: null,
    ...overrides,
  };
}

describe("displayName", () => {
  it("joins given name and surname", () => {
    expect(displayName(card())).toBe("Samuel Ashby");
  });

  it("falls back to the nickname when there is no name", () => {
    expect(
      displayName(card({ givenName: "", surname: "", nickname: "Jack" })),
    ).toBe("Jack");
  });

  it("falls back to Unknown when there is nothing", () => {
    expect(
      displayName(card({ givenName: " ", surname: "", nickname: "" })),
    ).toBe("Unknown");
  });
});

describe("formatLifespan", () => {
  const cases: ReadonlyArray<{
    birthYear: number | null;
    deathYear: number | null;
    expected: string;
  }> = [
    { birthYear: 1830, deathYear: 1901, expected: "1830–1901" },
    { birthYear: 1958, deathYear: null, expected: "b. 1958" },
    { birthYear: null, deathYear: 1901, expected: "d. 1901" },
    { birthYear: null, deathYear: null, expected: "" },
  ];

  for (const { birthYear, deathYear, expected } of cases) {
    it(`${birthYear ?? "–"} / ${deathYear ?? "–"} → "${expected}"`, () => {
      expect(formatLifespan(card({ birthYear, deathYear }))).toBe(expected);
    });
  }
});

describe("escapeHtml", () => {
  it("escapes every HTML metacharacter", () => {
    expect(escapeHtml(`<a href="x" onmouseover='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onmouseover=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("personCardHtml", () => {
  it("renders name, years, gender modifier and a silhouette by default", () => {
    const html = personCardHtml(PERSON_ID, card());
    expect(html).toContain('class="rw-card rw-card--male"');
    expect(html).toContain("Samuel Ashby");
    expect(html).toContain("1830–1901");
    expect(html).toContain("rw-card__photo--silhouette");
    expect(html).toContain("<svg");
  });

  it("renders an <img> when there is an avatar and no silhouette", () => {
    const html = personCardHtml(
      PERSON_ID,
      card({ avatarUrl: "https://example.test/a.jpg" }),
    );
    expect(html).toContain('src="https://example.test/a.jpg"');
    expect(html).not.toContain("silhouette");
  });

  it("omits the years line when there are no dates", () => {
    const html = personCardHtml(
      PERSON_ID,
      card({ birthYear: null, deathYear: null }),
    );
    expect(html).not.toContain("rw-card__years");
  });

  it("escapes a name that contains markup", () => {
    const html = personCardHtml(
      PERSON_ID,
      card({ givenName: '<img src=x onerror="alert(1)">', surname: "" }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes an avatar url", () => {
    const html = personCardHtml(
      PERSON_ID,
      card({ avatarUrl: '"><script>x</script>' }),
    );
    expect(html).not.toContain("<script>");
  });

  it("shows a duplicate badge only when the count is above one", () => {
    expect(personCardHtml(PERSON_ID, card(), 2)).toContain(
      'class="rw-card__dup"',
    );
    expect(personCardHtml(PERSON_ID, card(), 2)).toContain("×2");
    expect(personCardHtml(PERSON_ID, card(), 0)).not.toContain("rw-card__dup");
    expect(personCardHtml(PERSON_ID, card(), 1)).not.toContain("rw-card__dup");
  });

  it("uses the neutral modifier for an unknown-sex person", () => {
    expect(personCardHtml(PERSON_ID, card({ sex: "neutral" }))).toContain(
      "rw-card rw-card--neutral",
    );
  });

  it("omits every expand affordance by default", () => {
    const html = personCardHtml(PERSON_ID, card());
    expect(html).not.toContain("rw-card__expand");
  });

  it("shows the ancestor affordance only when canExpandUp is set", () => {
    const html = personCardHtml(PERSON_ID, card({ canExpandUp: true }));
    expect(html).toContain("rw-card__expand--up");
    expect(html).toContain(`data-expand-target="${PERSON_ID}"`);
    expect(html).toContain(`data-expand-anchor="${PERSON_ID}"`);
    expect(html).toContain('data-expand-relation="parents"');
  });

  it("shows the descendant affordance only when canExpandDown is set", () => {
    const html = personCardHtml(PERSON_ID, card({ canExpandDown: true }));
    expect(html).toContain("rw-card__expand--down");
    expect(html).toContain(`data-expand-target="${PERSON_ID}"`);
    expect(html).toContain('data-expand-relation="children"');
  });

  it("shows the hidden-partner affordance targeting the hidden id", () => {
    const html = personCardHtml(
      PERSON_ID,
      card({ hiddenPartnerId: PARTNER_ID }),
    );
    expect(html).toContain("rw-card__expand--partner");
    expect(html).toContain(`data-expand-target="${PARTNER_ID}"`);
    expect(html).toContain(`data-expand-anchor="${PERSON_ID}"`);
    expect(html).toContain('data-expand-relation="self"');
  });

  it("escapes an id used in an expand affordance", () => {
    const html = personCardHtml(
      '"><script>x</script>',
      card({
        canExpandUp: true,
      }),
    );
    expect(html).not.toContain("<script>");
  });
});
