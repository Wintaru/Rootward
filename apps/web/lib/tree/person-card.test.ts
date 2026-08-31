import { describe, expect, it } from "vitest";

import {
  displayName,
  escapeHtml,
  formatLifespan,
  personCardHtml,
} from "./person-card";
import type { FamilyChartPersonData } from "./to-family-chart";

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
    const html = personCardHtml(card());
    expect(html).toContain('class="rw-card rw-card--male"');
    expect(html).toContain("Samuel Ashby");
    expect(html).toContain("1830–1901");
    expect(html).toContain("rw-card__photo--silhouette");
    expect(html).toContain("<svg");
  });

  it("renders an <img> when there is an avatar and no silhouette", () => {
    const html = personCardHtml(
      card({ avatarUrl: "https://example.test/a.jpg" }),
    );
    expect(html).toContain('src="https://example.test/a.jpg"');
    expect(html).not.toContain("silhouette");
  });

  it("omits the years line when there are no dates", () => {
    const html = personCardHtml(card({ birthYear: null, deathYear: null }));
    expect(html).not.toContain("rw-card__years");
  });

  it("escapes a name that contains markup", () => {
    const html = personCardHtml(
      card({ givenName: '<img src=x onerror="alert(1)">', surname: "" }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes an avatar url", () => {
    const html = personCardHtml(card({ avatarUrl: '"><script>x</script>' }));
    expect(html).not.toContain("<script>");
  });

  it("shows a duplicate badge only when the count is above one", () => {
    expect(personCardHtml(card(), 2)).toContain('class="rw-card__dup"');
    expect(personCardHtml(card(), 2)).toContain("×2");
    expect(personCardHtml(card(), 0)).not.toContain("rw-card__dup");
    expect(personCardHtml(card(), 1)).not.toContain("rw-card__dup");
  });

  it("uses the neutral modifier for an unknown-sex person", () => {
    expect(personCardHtml(card({ sex: "neutral" }))).toContain(
      "rw-card rw-card--neutral",
    );
  });
});
