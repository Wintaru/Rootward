// Generate the large demo tree: a GEDCOM 5.5.1 file plus a media manifest.
//
//   node scripts/demo-tree/generate.mjs [--seed N] [--target N] [--trace a,b,c,d]
//
// Everything here is deterministic: the same seed produces byte-identical
// output, so `docs/reference/rootward-demo/rootward-demo.ged` is committed and
// diffable. The images the manifest names are fetched separately by
// `build-gedzip.mjs` (network), which also zips the `.ged` and the media into
// the GedZip the `/import` screen accepts.
//
// The tree is fictional. It is built to exercise every column the importer can
// fill (see `packages/gedcom/src/reader.ts` for the tag → column mapping) and
// every family shape the product has to render: married, divorced,
// remarried, annulled, widowed, unmarried partners, same-sex couples, single
// parents, adopted / step / foster / guardian / sealed children, twins, a
// first-cousin marriage (pedigree collapse), an unlinked stray family, and
// people of unknown or other sex. Dates cover every `genealogy_date_kind` and
// every calendar the parser knows. A handful of living people carry
// Rootward's own `_ROOTWARD_VIS` tag (#126) so the visibility ladder --
// `hidden`, `moderators_only`, `close_family` -- is in the tree from the
// import, and two facts on visible people are marked the same way.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}
const SEED = Number(argValue("--seed", "20260921"));
const TARGET_PERSONS = Number(argValue("--target", "560"));
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/reference/rootward-demo",
);
const GED_FILENAME = "rootward-demo.ged";
const MANIFEST_FILENAME = "media-manifest.json";

/** The year the generator treats as "now" — fixed so output never drifts. */
const CURRENT_YEAR = 2026;
/** `HEAD.DATE` and every `CHAN.DATE`, fixed for the same reason. */
const GENERATED_ON = "21 SEP 2026";
/** Photography starts here; an earlier portrait is "a painted portrait". */
const FIRST_PHOTO_YEAR = 1840;
/** Portraits of people born before this are served in monochrome. */
const COLOUR_PHOTO_BIRTH_YEAR = 1930;

// ---------------------------------------------------------------------------
// PRNG (mulberry32) — small, seedable, good enough for data generation
// ---------------------------------------------------------------------------

class Rng {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [lo, hi], inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Pick by weight: `[[value, weight], ...]`. */
  weighted(pairs) {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, w] of pairs) {
      r -= w;
      if (r <= 0) {
        return value;
      }
    }
    return pairs[pairs.length - 1][0];
  }
}

const rng = new Rng(SEED);

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const HEBREW_MONTHS = ["TSH", "CSH", "KSL", "TVT", "SHV", "ADR", "NSN", "IYR"];
const FRENCH_MONTHS = ["VEND", "BRUM", "FRIM", "NIVO", "PLUV", "VENT", "GERM"];

/** Given names by sex and rough era of birth. */
const GIVEN = {
  M: {
    1740: ["Ezra", "Obadiah", "Silas", "Jonas", "Amos", "Reuben"],
    1790: [
      "Thomas",
      "William",
      "Josiah",
      "Elijah",
      "Nathaniel",
      "Patrick",
      "Michael",
      "Anders",
      "Johan",
      "Stanislaw",
      "Wojciech",
      "Moses",
      "Abraham",
      "Dimitrios",
      "Georgios",
      "Jean-Baptiste",
      "Auguste",
      "Ignacio",
      "Hiroshi",
    ],
    1850: [
      "Henry",
      "Charles",
      "George",
      "Frank",
      "Walter",
      "Albert",
      "Edward",
      "Arthur",
      "Frederick",
      "Louis",
      "Samuel",
      "Isaac",
      "Daniel",
      "Peter",
      "Karl",
      "Nils",
      "Jozef",
      "Kazimierz",
      "Nikolaos",
      "Émile",
      "Ramón",
      "Kenji",
    ],
    1900: [
      "John",
      "Robert",
      "James",
      "Richard",
      "Donald",
      "Raymond",
      "Harold",
      "Eugene",
      "Leonard",
      "Ralph",
      "Stanley",
      "Bernard",
      "Leo",
      "Theodore",
      "Vincent",
      "Anthony",
      "Carl",
      "Roy",
      "Milton",
      "Herbert",
    ],
    1945: [
      "Michael",
      "David",
      "Steven",
      "Gary",
      "Mark",
      "Kevin",
      "Brian",
      "Jeffrey",
      "Scott",
      "Timothy",
      "Gregory",
      "Dennis",
      "Paul",
      "Douglas",
      "Craig",
      "Randall",
      "Keith",
      "Chukwuemeka",
      "Tomás",
      "Ken",
    ],
    1980: [
      "Jacob",
      "Ethan",
      "Noah",
      "Liam",
      "Mason",
      "Logan",
      "Tyler",
      "Ryan",
      "Nathan",
      "Caleb",
      "Owen",
      "Lucas",
      "Aiden",
      "Elijah",
      "Julian",
      "Mateo",
      "Ezra",
      "Kai",
      "Obinna",
      "Isaac",
    ],
  },
  F: {
    1740: ["Mercy", "Patience", "Hepzibah", "Thankful", "Lydia", "Abigail"],
    1790: [
      "Mary",
      "Sarah",
      "Elizabeth",
      "Hannah",
      "Margaret",
      "Bridget",
      "Catherine",
      "Anna",
      "Kristina",
      "Ingrid",
      "Jadwiga",
      "Zofia",
      "Rivka",
      "Leah",
      "Eleni",
      "Sophia",
      "Marie",
      "Joséphine",
      "Guadalupe",
      "Haru",
    ],
    1850: [
      "Emma",
      "Alice",
      "Clara",
      "Ida",
      "Minnie",
      "Bertha",
      "Ella",
      "Florence",
      "Edith",
      "Grace",
      "Ethel",
      "Mabel",
      "Rose",
      "Esther",
      "Miriam",
      "Agnes",
      "Helga",
      "Stanislawa",
      "Despina",
      "Louise",
      "Rosa",
      "Yuki",
    ],
    1900: [
      "Dorothy",
      "Helen",
      "Ruth",
      "Mildred",
      "Betty",
      "Shirley",
      "Doris",
      "Lois",
      "Marjorie",
      "Jean",
      "Phyllis",
      "Irene",
      "Evelyn",
      "Beatrice",
      "Gladys",
      "Marion",
      "Sylvia",
      "Rita",
      "Frances",
      "Lorraine",
    ],
    1945: [
      "Linda",
      "Susan",
      "Karen",
      "Patricia",
      "Deborah",
      "Barbara",
      "Nancy",
      "Cynthia",
      "Sandra",
      "Pamela",
      "Laura",
      "Julie",
      "Lisa",
      "Kimberly",
      "Michelle",
      "Tracy",
      "Amy",
      "Ngozi",
      "Elena",
      "Naomi",
    ],
    1980: [
      "Emily",
      "Hannah",
      "Olivia",
      "Ava",
      "Sophia",
      "Chloe",
      "Madison",
      "Isabella",
      "Grace",
      "Lily",
      "Zoe",
      "Nora",
      "Maya",
      "Harper",
      "Amelia",
      "Aria",
      "Ellie",
      "Adaeze",
      "Camila",
      "Mia",
    ],
  },
};

const NICKNAMES = {
  William: "Bill",
  Robert: "Bob",
  Richard: "Dick",
  James: "Jim",
  John: "Jack",
  Michael: "Mike",
  Edward: "Ned",
  Charles: "Charlie",
  Thomas: "Tom",
  Frederick: "Fred",
  Theodore: "Teddy",
  Anthony: "Tony",
  Elizabeth: "Bessie",
  Margaret: "Peggy",
  Catherine: "Kitty",
  Dorothy: "Dot",
  Mildred: "Millie",
  Patricia: "Patty",
  Deborah: "Debbie",
  Susan: "Sue",
  Kimberly: "Kim",
  Isabella: "Izzy",
  Samuel: "Sam",
  Daniel: "Danny",
  Jeffrey: "Jeff",
  Gregory: "Greg",
  Timothy: "Tim",
  Kenji: "Ken",
  Chukwuemeka: "Emeka",
};

/** Surnames for people who marry into the tree, by era of birth. */
const MARRY_IN_SURNAMES = [
  "Ashworth",
  "Barlow",
  "Calloway",
  "Dunmore",
  "Ellery",
  "Fairbanks",
  "Garrity",
  "Holloway",
  "Ingram",
  "Jessup",
  "Kellerman",
  "Lockhart",
  "Mercer",
  "Norwood",
  "Overton",
  "Pemberton",
  "Quimby",
  "Radford",
  "Sutcliffe",
  "Thackeray",
  "Underhill",
  "Vasquez",
  "Whitfield",
  "Yardley",
  "Zimmerman",
  "O'Rourke",
  "Fitzgerald",
  "Novak",
  "Bergström",
  "Castellano",
  "Weiss",
  "Nguyen",
  "Patel",
  "Kim",
  "Silva",
  "Haddad",
  "Larsen",
  "Moreau",
  "Schreiber",
  "Delgado",
];

/**
 * The founding lines. `origin` is where the line starts, `settled` where it
 * lands, `arrival` the year the founders immigrated (null: already there).
 * `religion` drives which religious events the line's children get.
 */
const LINES = [
  {
    key: "whitlock",
    surname: "Whitlock",
    origin: { name: "Ipswich, Essex, Massachusetts, USA", region: "ma" },
    settled: { name: "Ipswich, Essex, Massachusetts, USA", region: "ma" },
    arrival: null,
    foundersBorn: 1782,
    religion: "protestant",
    nationality: "American",
    ethnic: "English",
    gen0: "dual", // parents with 1749/50-style dual-year dates
    given: {
      M: ["Ezra", "Josiah", "Nathaniel", "Thomas", "Obadiah", "Silas"],
      F: ["Mercy", "Hannah", "Abigail", "Lydia", "Patience", "Sarah"],
    },
  },
  {
    key: "brennan",
    surname: "Brennan",
    origin: { name: "Skibbereen, County Cork, Ireland", region: "ie" },
    settled: { name: "Lowell, Middlesex, Massachusetts, USA", region: "ma" },
    arrival: 1848,
    foundersBorn: 1818,
    religion: "catholic",
    nationality: "Irish",
    ethnic: "Irish",
    gen0: null,
    given: {
      M: ["Patrick", "Michael", "Cornelius", "Denis", "Jeremiah"],
      F: ["Bridget", "Mary", "Catherine", "Honora", "Margaret"],
    },
  },
  {
    key: "lindqvist",
    surname: "Lindquist",
    birthSurname: "Lindqvist",
    origin: { name: "Växjö, Kronoberg, Sweden", region: "se" },
    settled: { name: "Red Wing, Goodhue, Minnesota, USA", region: "mn" },
    arrival: 1868,
    foundersBorn: 1838,
    religion: "lutheran",
    nationality: "Swedish",
    ethnic: "Swedish",
    gen0: null,
    anglicize: {
      Johan: "John",
      Anders: "Andrew",
      Nils: "Nels",
      Karl: "Charles",
      Gustaf: "Gus",
      Kristina: "Christina",
      Maja: "Mary",
    },
    given: {
      M: ["Johan", "Anders", "Nils", "Karl", "Gustaf"],
      F: ["Kristina", "Ingrid", "Helga", "Anna", "Maja"],
    },
  },
  {
    key: "kowalczyk",
    surname: "Kowalczyk",
    origin: { name: "Tarnów, Lesser Poland, Poland", region: "pl" },
    settled: { name: "Scranton, Lackawanna, Pennsylvania, USA", region: "pa" },
    arrival: 1905,
    foundersBorn: 1878,
    religion: "catholic",
    nationality: "Polish",
    ethnic: "Polish",
    gen0: null,
    given: {
      M: ["Stanislaw", "Wojciech", "Jozef", "Kazimierz", "Jan"],
      F: ["Jadwiga", "Zofia", "Stanislawa", "Maria", "Helena"],
    },
  },
  {
    key: "rosenthal",
    surname: "Rosenthal",
    origin: { name: "Vilnius, Lithuania", region: "lt" },
    settled: { name: "Brooklyn, Kings, New York, USA", region: "ny" },
    arrival: 1891,
    foundersBorn: 1862,
    religion: "jewish",
    nationality: "Lithuanian",
    ethnic: "Ashkenazi Jewish",
    gen0: null,
    given: {
      M: ["Moses", "Abraham", "Isaac", "Samuel", "Jacob"],
      F: ["Rivka", "Leah", "Esther", "Miriam", "Sarah"],
    },
  },
  {
    key: "papadakis",
    surname: "Papadakis",
    origin: { name: "Chania, Crete, Greece", region: "gr" },
    settled: { name: "Chicago, Cook, Illinois, USA", region: "il" },
    arrival: 1912,
    foundersBorn: 1886,
    religion: "orthodox",
    nationality: "Greek",
    ethnic: "Greek",
    gen0: null,
    julianUntil: 1923,
    given: {
      M: ["Dimitrios", "Georgios", "Nikolaos", "Konstantinos", "Yannis"],
      F: ["Eleni", "Sophia", "Despina", "Maria", "Katerina"],
    },
  },
  {
    key: "delacroix",
    surname: "Delacroix",
    origin: {
      name: "St. Martinville, St. Martin Parish, Louisiana, USA",
      region: "la",
    },
    settled: {
      name: "St. Martinville, St. Martin Parish, Louisiana, USA",
      region: "la",
    },
    arrival: null,
    foundersBorn: 1806,
    religion: "catholic",
    nationality: "American",
    ethnic: "Acadian French",
    gen0: "french", // a French Republican calendar marriage in gen 0
    given: {
      M: ["Jean-Baptiste", "Auguste", "Émile", "Pierre", "Louis"],
      F: ["Marie", "Joséphine", "Louise", "Célestine", "Adèle"],
    },
  },
];

/** Later places a family may move to, by region of the settled place. */
const REGION_PLACES = {
  ma: [
    "Ipswich, Essex, Massachusetts, USA",
    "Lowell, Middlesex, Massachusetts, USA",
    "Boston, Suffolk, Massachusetts, USA",
    "Worcester, Worcester, Massachusetts, USA",
    "Salem, Essex, Massachusetts, USA",
    "Providence, Providence, Rhode Island, USA",
    "Hartford, Hartford, Connecticut, USA",
  ],
  mn: [
    "Red Wing, Goodhue, Minnesota, USA",
    "Minneapolis, Hennepin, Minnesota, USA",
    "St. Paul, Ramsey, Minnesota, USA",
    "Duluth, St. Louis, Minnesota, USA",
    "Rochester, Olmsted, Minnesota, USA",
  ],
  pa: [
    "Scranton, Lackawanna, Pennsylvania, USA",
    "Wilkes-Barre, Luzerne, Pennsylvania, USA",
    "Philadelphia, Philadelphia, Pennsylvania, USA",
    "Pittsburgh, Allegheny, Pennsylvania, USA",
  ],
  ny: [
    "Brooklyn, Kings, New York, USA",
    "Manhattan, New York, New York, USA",
    "Queens, Queens, New York, USA",
    "Yonkers, Westchester, New York, USA",
    "Newark, Essex, New Jersey, USA",
  ],
  il: [
    "Chicago, Cook, Illinois, USA",
    "Evanston, Cook, Illinois, USA",
    "Milwaukee, Milwaukee, Wisconsin, USA",
    "Gary, Lake, Indiana, USA",
  ],
  la: [
    "St. Martinville, St. Martin Parish, Louisiana, USA",
    "Lafayette, Lafayette Parish, Louisiana, USA",
    "New Orleans, Orleans Parish, Louisiana, USA",
    "Baton Rouge, East Baton Rouge Parish, Louisiana, USA",
    "Houston, Harris, Texas, USA",
  ],
};

/** Where a modern (born 1950+) person may move, across regions. */
const MODERN_PLACES = [
  "Seattle, King, Washington, USA",
  "Portland, Multnomah, Oregon, USA",
  "Denver, Denver, Colorado, USA",
  "Austin, Travis, Texas, USA",
  "Atlanta, Fulton, Georgia, USA",
  "San Diego, San Diego, California, USA",
  "Oakland, Alameda, California, USA",
  "Phoenix, Maricopa, Arizona, USA",
  "Toronto, Ontario, Canada",
  "Vancouver, British Columbia, Canada",
  "London, Greater London, England",
  "Berlin, Germany",
];

const OCCUPATIONS = {
  1740: ["farmer", "cooper", "blacksmith", "housewright", "mariner"],
  1790: [
    "farmer",
    "shoemaker",
    "carpenter",
    "mill worker",
    "shipwright",
    "tailor",
    "stonemason",
    "fisherman",
    "labourer",
    "innkeeper",
  ],
  1850: [
    "railroad brakeman",
    "textile weaver",
    "farmer",
    "grocer",
    "machinist",
    "teacher",
    "dressmaker",
    "coal miner",
    "printer",
    "physician",
    "bookkeeper",
    "steelworker",
    "baker",
    "tailor",
    "dairy farmer",
  ],
  1900: [
    "electrician",
    "stenographer",
    "nurse",
    "postal clerk",
    "welder",
    "schoolteacher",
    "pharmacist",
    "telephone operator",
    "truck driver",
    "accountant",
    "police officer",
    "seamstress",
    "auto mechanic",
    "librarian",
    "insurance agent",
  ],
  1945: [
    "software engineer",
    "registered nurse",
    "high-school teacher",
    "civil engineer",
    "dental hygienist",
    "sales manager",
    "graphic designer",
    "paralegal",
    "electrician",
    "physical therapist",
    "chef",
    "journalist",
    "architect",
    "social worker",
    "pilot",
  ],
  1980: [
    "software developer",
    "UX designer",
    "data analyst",
    "nurse practitioner",
    "physiotherapist",
    "barista",
    "product manager",
    "veterinary technician",
    "teacher",
    "electrician",
    "marketing coordinator",
    "research scientist",
    "musician",
  ],
};

const DEATH_CAUSES = [
  "pneumonia",
  "heart failure",
  "influenza",
  "tuberculosis",
  "stroke",
  "cancer",
  "old age",
  "typhoid fever",
  "diphtheria",
  "accident at the mill",
  "drowning",
  "childbirth",
  "scarlet fever",
  "kidney disease",
  "myocardial infarction",
];

const EYE_COLOURS = ["blue", "brown", "green", "grey", "hazel"];
const HAIR_COLOURS = ["brown", "black", "blond", "red", "auburn", "grey"];

const BIO_SENTENCES = [
  "Known in the family for a dry sense of humour and an unbeatable pie crust.",
  "Kept a diary for most of {pronoun_pos} adult life; three volumes survive.",
  "Walked to church every Sunday regardless of the weather.",
  "Never learned to drive and saw no reason to start.",
  "Sang in the choir for over forty years.",
  "Could recite the whole of the family tree from memory, back to the crossing.",
  "Taught every one of the grandchildren to fish at the same bend in the river.",
  "Was the first in the family to finish high school.",
  "Ran the household accounts down to the last cent.",
  "Planted the pear tree that still stands behind the old house.",
  "Was said to have a temper, and a laugh that carried across the street.",
  "Spoke {language} at home and refused to speak anything else at the table.",
  "Lost a brother in the war and did not talk about it afterward.",
  "Built the porch swing that three later generations were photographed on.",
];

const IMMIGRANT_BIO_SENTENCES = [
  "Left the old country with one trunk and a letter of introduction.",
  "Wrote letters home every week for twenty years; the family still has them.",
  "Never went back, and never stopped talking about going back.",
];

const LANGUAGE_FOR_LINE = {
  whitlock: "English",
  brennan: "Irish",
  lindqvist: "Swedish",
  kowalczyk: "Polish",
  rosenthal: "Yiddish",
  papadakis: "Greek",
  delacroix: "French",
};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const persons = [];
const families = [];
const sources = [];
const repositories = [];
const mediaRecords = [];
const sharedNotes = [];
/** The media files `build-gedzip.mjs` must produce, keyed by archive path. */
const manifest = [];

function eraKey(year, table) {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (year >= k) {
      best = k;
    }
  }
  return best;
}

function givenNameFor(sex, year, line = null) {
  // Born in the old country: a name from that line's own pool.
  if (
    line !== null &&
    line.given !== undefined &&
    year < (line.arrival ?? line.foundersBorn + 1)
  ) {
    return rng.pick(line.given[sex === "F" ? "F" : "M"]);
  }
  const table = GIVEN[sex === "F" ? "F" : "M"];
  return rng.pick(table[eraKey(year, table)]);
}

function newPerson(fields) {
  const p = {
    id: persons.length + 1,
    given: null,
    surname: null,
    birthSurname: null,
    prefix: null,
    suffix: null,
    nick: null,
    sex: "M",
    line: null,
    gen: 0,
    birth: null,
    birthPlace: null,
    death: null,
    deathPlace: null,
    cause: null,
    disposal: "burial",
    famc: null,
    fams: [],
    /** `{ type, given, surname, prefix, suffix, nick }` additional NAME rows. */
    names: [],
    events: [],
    facts: [],
    notes: [],
    citations: [],
    media: [],
    tags: new Set(),
    homePlace: null,
    religion: null,
    nationality: null,
    ethnic: null,
    ...fields,
  };
  p.xref = `@I${p.id}@`;
  persons.push(p);
  return p;
}

function newFamily(fields) {
  const f = {
    id: families.length + 1,
    partner1: null,
    partner2: null,
    role1: "HUSB",
    role2: "WIFE",
    children: [],
    events: [],
    notes: [],
    citations: [],
    media: [],
    kind: "married",
    ended: null,
    marriage: null,
    marriagePlace: null,
    ...fields,
  };
  f.xref = `@F${f.id}@`;
  families.push(f);
  for (const p of [f.partner1, f.partner2]) {
    if (p !== null) {
      p.fams.push(f);
    }
  }
  return f;
}

function addChild(family, child, relation = null) {
  family.children.push({ person: child, relation });
  if (child.famc === null) {
    child.famc = family;
  }
}

// --- dates -----------------------------------------------------------------

function date(y, m, d) {
  return { y, m, d };
}

function randomDate(year) {
  const m = rng.int(1, 12);
  const d = rng.int(1, m === 2 ? 28 : 30);
  return date(year, m, d);
}

function addYears(dt, years, jitterMonths = 0) {
  let m =
    dt.m + (jitterMonths === 0 ? 0 : rng.int(-jitterMonths, jitterMonths));
  let y = dt.y + years;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return date(y, m, Math.min(dt.d, 28));
}

/** `dt` plus 0..`maxMonths` months — never earlier than `dt`. */
function after(dt, maxMonths) {
  let m = dt.m + rng.int(0, maxMonths);
  let y = dt.y;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return date(y, m, Math.min(dt.d, 28));
}

function compareDates(a, b) {
  return a.y - b.y || (a.m ?? 1) - (b.m ?? 1) || (a.d ?? 1) - (b.d ?? 1);
}

/** Age in whole years on `at`. */
function ageAt(birth, at) {
  let age = at.y - birth.y;
  if (
    (at.m ?? 1) < (birth.m ?? 1) ||
    (at.m === birth.m && (at.d ?? 1) < (birth.d ?? 1))
  ) {
    age -= 1;
  }
  return age;
}

function fmtExact(dt) {
  if (dt.m === undefined) {
    return String(dt.y);
  }
  if (dt.d === undefined) {
    return `${MONTHS[dt.m - 1]} ${dt.y}`;
  }
  return `${dt.d} ${MONTHS[dt.m - 1]} ${dt.y}`;
}

/**
 * Render a true date as GEDCOM text, sometimes as an approximate form so every
 * `genealogy_date_kind` appears in the seed. `opts.exact` forces the exact
 * form (birth dates of living people, and anything the demo must sort on).
 */
function renderDate(dt, opts = {}) {
  if (opts.calendar === "julian") {
    return `@#DJULIAN@ ${fmtExact(dt)}`;
  }
  if (opts.dual && dt.m <= 3) {
    // Old-style year: Jan–Mar dates before 1752 carried both years.
    const prev = String(dt.y - 1);
    return `${dt.d} ${MONTHS[dt.m - 1]} ${prev}/${String(dt.y).slice(-2)}`;
  }
  if (opts.exact) {
    return fmtExact(dt);
  }
  const kind = rng.weighted([
    ["exact", 74],
    ["month", 4],
    ["year", 4],
    ["about", 6],
    ["estimated", 2],
    ["calculated", 2],
    ["before", 2],
    ["after", 2],
    ["between", 2],
    ["interpreted", 1],
    ["phrase", 1],
  ]);
  switch (kind) {
    case "month":
      return fmtExact(date(dt.y, dt.m));
    case "year":
      return String(dt.y);
    case "about":
      return `ABT ${rng.chance(0.5) ? String(dt.y) : fmtExact(dt)}`;
    case "estimated":
      return `EST ${dt.y}`;
    case "calculated":
      return `CAL ${fmtExact(dt)}`;
    case "before":
      return `BEF ${fmtExact(addYears(dt, 1))}`;
    case "after":
      return `AFT ${fmtExact(addYears(dt, -1))}`;
    case "between":
      return `BET ${dt.y - 1} AND ${dt.y + 1}`;
    case "interpreted":
      return `INT ${fmtExact(dt)} (${rng.pick(["the spring after the flood", "the year the mill burned", "just after the harvest"])})`;
    case "phrase":
      return `(${rng.pick(["sometime in the war years", "when the river froze", "the winter the barn was raised"])})`;
    default:
      return fmtExact(dt);
  }
}

// --- helpers ---------------------------------------------------------------

function pronouns(p) {
  if (p.sex === "F") {
    return { subj: "she", obj: "her", pos: "her" };
  }
  if (p.sex === "M") {
    return { subj: "he", obj: "him", pos: "his" };
  }
  return { subj: "they", obj: "them", pos: "their" };
}

function fullName(p) {
  return [p.given, p.surname].filter(Boolean).join(" ");
}

function isAlive(p, at) {
  return p.death === null || compareDates(p.death, at) > 0;
}

/** Every ancestor within `depth` generations, as a Set of persons. */
function ancestors(p, depth) {
  const out = new Set();
  let frontier = [p];
  for (let i = 0; i < depth; i++) {
    const next = [];
    for (const x of frontier) {
      if (x.famc === null) {
        continue;
      }
      for (const parent of [x.famc.partner1, x.famc.partner2]) {
        if (parent !== null && !out.has(parent)) {
          out.add(parent);
          next.push(parent);
        }
      }
    }
    frontier = next;
  }
  return out;
}

function related(a, b, depth = 4) {
  const aa = ancestors(a, depth);
  aa.add(a);
  const bb = ancestors(b, depth);
  bb.add(b);
  for (const x of aa) {
    if (bb.has(x)) {
      return true;
    }
  }
  return false;
}

function areFirstCousins(a, b) {
  if (a.famc === null || b.famc === null || a.famc === b.famc) {
    return false;
  }
  const ga = ancestors(a, 2);
  const gb = ancestors(b, 2);
  const pa = ancestors(a, 1);
  const pb = ancestors(b, 1);
  for (const x of pa) {
    if (pb.has(x)) {
      return false; // siblings / half-siblings
    }
  }
  for (const x of ga) {
    if (gb.has(x) && !pa.has(x) && !pb.has(x)) {
      return true;
    }
  }
  return false;
}

function pickPlaceNear(place, region, year) {
  if (year >= 1950 && rng.chance(0.12)) {
    return { name: rng.pick(MODERN_PLACES), region };
  }
  if (rng.chance(0.3)) {
    return { name: rng.pick(REGION_PLACES[region] ?? [place]), region };
  }
  return { name: place, region };
}

// ---------------------------------------------------------------------------
// Sources and repositories
// ---------------------------------------------------------------------------

function newRepository(fields) {
  const r = { id: repositories.length + 1, ...fields };
  r.xref = `@R${r.id}@`;
  repositories.push(r);
  return r;
}

function newSource(fields) {
  const s = { id: sources.length + 1, media: null, ...fields };
  s.xref = `@S${s.id}@`;
  sources.push(s);
  return s;
}

const REPOS = {
  nara: newRepository({
    name: "National Archives and Records Administration",
    address: "700 Pennsylvania Avenue NW, Washington, DC 20408, USA",
    phone: "+1 866-272-6272",
    email: "inquire@nara.gov",
    website: "https://www.archives.gov",
  }),
  maArchives: newRepository({
    name: "Massachusetts Archives",
    address: "220 Morrissey Boulevard, Boston, MA 02125, USA",
    phone: "+1 617-727-2816",
    email: "archives@sec.state.ma.us",
    website: "https://www.sec.state.ma.us/arc/",
  }),
  mnhs: newRepository({
    name: "Minnesota Historical Society",
    address: "345 W Kellogg Blvd, St. Paul, MN 55102, USA",
    phone: "+1 651-259-3000",
    email: "reference@mnhs.org",
    website: "https://www.mnhs.org",
  }),
  diocese: newRepository({
    name: "Archives of the Diocese of Scranton",
    address: "300 Wyoming Avenue, Scranton, PA 18503, USA",
    phone: "+1 570-207-2238",
    email: "archives@dioceseofscranton.org",
    website: "https://www.dioceseofscranton.org",
  }),
  fsl: newRepository({
    name: "FamilySearch Library",
    address: "35 N West Temple St, Salt Lake City, UT 84150, USA",
    phone: "+1 866-406-1830",
    email: "support@familysearch.org",
    website: "https://www.familysearch.org/library/",
  }),
  cork: newRepository({
    name: "Cork City and County Archives",
    address: "33a Great William O'Brien Street, Blackpool, Cork, Ireland",
    phone: "+353 21 450 5886",
    email: "archivist@corkcity.ie",
    website: "https://www.corkarchives.ie",
  }),
  attic: newRepository({
    name: "The Whitlock family papers (private collection)",
    address: "In the attic of the old house on High Street, Ipswich, MA, USA",
    phone: null,
    email: null,
    website: null,
  }),
};

const SOURCE_BY_ROLE = {
  bible: newSource({
    title: "Whitlock family Bible, births and deaths register",
    author: "Various hands, 1749–1931",
    publication: "Manuscript; family collection",
    repo: REPOS.attic,
    text: "The register pages record births, marriages, and deaths in at least six hands over 180 years.",
  }),
  maVital: newSource({
    title: "Massachusetts Vital Records, 1841–1915",
    author: "Commonwealth of Massachusetts",
    publication: "Boston: Massachusetts Archives; microfilm",
    repo: REPOS.maArchives,
    text: "Town-by-town returns of births, marriages, and deaths.",
  }),
  corkParish: newSource({
    title: "Parish registers of Skibbereen, Roman Catholic, 1814–1880",
    author: "Diocese of Cork and Ross",
    publication: "Cork: National Library of Ireland microfilm, 1950",
    repo: REPOS.cork,
    text: "Baptisms and marriages in Latin; many pages water-damaged.",
  }),
  manifests: newSource({
    title: "Passenger lists of vessels arriving at Boston, 1820–1891",
    author: "U.S. Customs Service",
    publication: "Washington: National Archives microfilm M277",
    repo: REPOS.nara,
    text: "Lists include name, age, sex, occupation, and country of origin.",
  }),
  ellis: newSource({
    title:
      "Passenger and crew lists of vessels arriving at New York, 1897–1957",
    author: "U.S. Immigration and Naturalization Service",
    publication: "Washington: National Archives microfilm T715",
    repo: REPOS.nara,
    text: "Manifests with the 1907-onward 30-column format.",
  }),
  swedishParish: newSource({
    title: "Växjö domkyrkoförsamling, husförhörslängder 1830–1870",
    author: "Church of Sweden",
    publication: "Vadstena: Landsarkivet",
    repo: REPOS.fsl,
    text: "Household examination rolls listing each family by farm.",
  }),
  mnChurch: newSource({
    title: "First Lutheran Church of Red Wing, Minnesota, records 1868–1960",
    author: "First Lutheran Church",
    publication: "St. Paul: Minnesota Historical Society",
    repo: REPOS.mnhs,
    text: "Baptisms, confirmations, marriages, and burials.",
  }),
  scrantonParish: newSource({
    title: "St. Stanislaus Church, Scranton, sacramental registers 1885–1970",
    author: "St. Stanislaus Parish",
    publication: "Scranton: Diocese of Scranton archives",
    repo: REPOS.diocese,
    text: "Registers kept in Polish until 1932, then in English.",
  }),
  nyVital: newSource({
    title:
      "New York City Municipal Archives, birth, marriage and death indexes",
    author: "City of New York",
    publication: "New York: Department of Records",
    repo: REPOS.fsl,
    text: "Indexes by borough and year with certificate numbers.",
  }),
  greekParish: newSource({
    title: "Chania Metropolis baptismal and marriage registers, 1880–1925",
    author: "Holy Metropolis of Kydonia and Apokoronas",
    publication: "Chania: Metropolis archive",
    repo: REPOS.fsl,
    text: "Entries dated in the Julian calendar until March 1923.",
  }),
  laChurch: newSource({
    title: "St. Martin de Tours Church, sacramental records 1765–1920",
    author: "Diocese of Lafayette",
    publication: "Lafayette: Diocese of Lafayette archives",
    repo: REPOS.fsl,
    text: "Baptisms, marriages, and burials; early volumes in French.",
  }),
  military: newSource({
    title: "World War II Army enlistment records, 1938–1946",
    author: "U.S. Army Adjutant General's Office",
    publication: "Washington: National Archives, Record Group 64",
    repo: REPOS.nara,
    text: "Serial number, enlistment date and place, and civilian occupation.",
  }),
  obituaries: newSource({
    title: "Obituary clippings, assorted newspapers 1890–2020",
    author: "Compiled by the family",
    publication: "Scrapbook; family collection",
    repo: REPOS.attic,
    text: "Clippings pasted in date order, most without the newspaper's name.",
  }),
  cemetery: newSource({
    title: "Find a Grave and cemetery transcriptions",
    author: "Various contributors",
    publication: "https://www.findagrave.com",
    repo: REPOS.fsl,
    text: "Headstone photographs and transcriptions.",
  }),
};

const CENSUS_YEARS = [
  1850, 1860, 1870, 1880, 1900, 1910, 1920, 1930, 1940, 1950,
];
const CENSUS_SOURCES = new Map(
  CENSUS_YEARS.map((y) => [
    y,
    newSource({
      title: `${y} United States Federal Census`,
      author: "U.S. Census Bureau",
      publication: `Washington: National Archives microfilm, ${y}`,
      repo: REPOS.nara,
      text: `Population schedule, ${y}.`,
    }),
  ]),
);

const PARISH_SOURCE_FOR_LINE = {
  whitlock: SOURCE_BY_ROLE.bible,
  brennan: SOURCE_BY_ROLE.corkParish,
  lindqvist: SOURCE_BY_ROLE.swedishParish,
  kowalczyk: SOURCE_BY_ROLE.scrantonParish,
  rosenthal: SOURCE_BY_ROLE.nyVital,
  papadakis: SOURCE_BY_ROLE.greekParish,
  delacroix: SOURCE_BY_ROLE.laChurch,
};

const CHURCH_SOURCE_FOR_REGION = {
  ma: SOURCE_BY_ROLE.maVital,
  mn: SOURCE_BY_ROLE.mnChurch,
  pa: SOURCE_BY_ROLE.scrantonParish,
  ny: SOURCE_BY_ROLE.nyVital,
  il: SOURCE_BY_ROLE.greekParish,
  la: SOURCE_BY_ROLE.laChurch,
};

function citation(source, page, opts = {}) {
  return {
    source,
    page,
    quality: opts.quality ?? rng.int(1, 3),
    dataText: opts.dataText ?? null,
    dataDate: opts.dataDate ?? null,
    note: opts.note ?? null,
  };
}

function vitalSourceFor(p, year) {
  if (year < 1850 && p.line !== null) {
    return PARISH_SOURCE_FOR_LINE[p.line.key] ?? SOURCE_BY_ROLE.bible;
  }
  const region = p.homePlace?.region ?? p.line?.settled.region ?? "ma";
  return CHURCH_SOURCE_FOR_REGION[region] ?? SOURCE_BY_ROLE.maVital;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * Register a media file. `kind` picks the archive folder and the fetch
 * recipe `build-gedzip.mjs` uses: `portrait` (square kitten), `photo`
 * (landscape kitten), `document` (a generated PDF). Returns the OBJE record.
 */
function newMedia(kind, fields) {
  const id = mediaRecords.length + 1;
  const stem = `${kind}-${String(id).padStart(4, "0")}`;
  const ext = kind === "document" ? "pdf" : "jpg";
  // Flat basenames next to the GEDCOM, like a MacFamilyTree export's media
  // folder zipped up; `FORM` carries the MIME type as MacFamilyTree writes it.
  const file = `${stem}.${ext}`;
  const m = {
    id,
    file,
    form: kind === "document" ? "application/pdf" : "image/jpeg",
    title: fields.title,
    date: fields.date ?? null,
    note: fields.note ?? null,
  };
  m.xref = `@O${id}@`;
  mediaRecords.push(m);
  manifest.push({
    path: file,
    kind,
    mono: fields.mono ?? false,
    seed: `${SEED}-${stem}`,
    ...(kind === "document" ? { lines: fields.lines } : {}),
  });
  return m;
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

/** Children per family by the family's marriage year. Weighted tables. */
function childCountFor(year) {
  if (year < 1860) {
    return rng.weighted([
      [0, 6],
      [1, 6],
      [2, 10],
      [3, 14],
      [4, 16],
      [5, 16],
      [6, 12],
      [7, 8],
      [8, 5],
      [9, 3],
      [10, 2],
      [11, 1],
      [12, 1],
    ]);
  }
  if (year < 1920) {
    return rng.weighted([
      [0, 8],
      [1, 10],
      [2, 18],
      [3, 20],
      [4, 18],
      [5, 12],
      [6, 7],
      [7, 4],
      [8, 2],
      [9, 1],
    ]);
  }
  if (year < 1975) {
    return rng.weighted([
      [0, 10],
      [1, 20],
      [2, 32],
      [3, 22],
      [4, 10],
      [5, 4],
      [6, 2],
    ]);
  }
  return rng.weighted([
    [0, 22],
    [1, 30],
    [2, 32],
    [3, 12],
    [4, 4],
  ]);
}

/** Decide death for a person given birth; null for the living. */
function assignDeath(p, opts = {}) {
  const b = p.birth;
  if (p.death !== null) {
    return;
  }
  // Child mortality in the early eras (never for a spouse marrying in).
  if (!opts.adult && b.y < 1900 && rng.chance(0.09)) {
    p.death = addYears(b, rng.int(0, 6), 5);
    p.cause = rng.pick([
      "diphtheria",
      "scarlet fever",
      "influenza",
      "drowning",
    ]);
    return;
  }
  if (
    b.y < 1930 ||
    (b.y < 1945 && rng.chance(0.7)) ||
    (b.y < 1960 && rng.chance(0.3)) ||
    (b.y < 1985 && rng.chance(0.06)) ||
    rng.chance(0.015)
  ) {
    const lifespan =
      b.y < 1850
        ? rng.int(38, 84)
        : b.y < 1900
          ? rng.int(45, 89)
          : b.y < 1955
            ? rng.int(58, 96)
            : rng.int(24, 70);
    let d = addYears(b, lifespan, 6);
    if (d.y >= CURRENT_YEAR) {
      d = date(CURRENT_YEAR - rng.int(1, 4), rng.int(1, 12), rng.int(1, 28));
    }
    p.death = d;
    p.cause = rng.pick(DEATH_CAUSES);
  }
}

function setupNameBits(p, father) {
  if (p.given === null) {
    p.given = givenNameFor(p.sex, p.birth.y, p.line);
  }
  if (father !== null && p.sex === "M" && rng.chance(0.06)) {
    p.given = father.given;
    p.suffix = father.suffix === "Jr." ? "III" : "Jr.";
    if (father.suffix === null) {
      father.suffix = "Sr.";
    }
  }
  const nick = NICKNAMES[p.given];
  if (nick !== undefined && rng.chance(0.6)) {
    p.nick = nick;
  }
}

/** Undo a `marryIn` whose union was dropped, so no stray person is left. */
function dropUnpairedMarryIn(p) {
  if (persons[persons.length - 1] === p && p.fams.length === 0) {
    persons.pop();
  }
}

/** A person who marries into the tree: no parents recorded. */
function marryIn(sex, birthYear, region) {
  const p = newPerson({
    sex,
    gen: 0,
    birth: randomDate(birthYear),
    tags: new Set(["marry-in"]),
  });
  p.surname = rng.pick(MARRY_IN_SURNAMES);
  p.birthSurname = p.surname;
  p.homePlace = {
    name: rng.pick(REGION_PLACES[region] ?? REGION_PLACES.ma),
    region,
  };
  p.birthPlace = p.homePlace;
  setupNameBits(p, null);
  assignDeath(p, { adult: true });
  return p;
}

/**
 * Give `a` and `b` a union. Handles surnames (a married-name record for a
 * wife before ~1990), the marriage event, and how the union ends.
 */
function unite(a, b, opts = {}) {
  const older = compareDates(a.birth, b.birth) <= 0 ? a : b;
  const younger = older === a ? b : a;
  const minYear = Math.max(older.birth.y + 20, younger.birth.y + 18);
  // Nobody marries after their own death: the latest possible year is the
  // year before the earlier death. `opts.at` is a caller-chosen date (a
  // remarriage after the first union ended); both forms return null when
  // no living date exists, and the caller drops the union.
  const deaths = [a.death, b.death].filter((d) => d !== null);
  const latestYear =
    deaths.length === 0
      ? CURRENT_YEAR - 1
      : Math.min(...deaths.map((d) => d.y)) - 1;
  let marriage;
  if (opts.at !== undefined) {
    if (!isAlive(a, opts.at) || !isAlive(b, opts.at)) {
      return null;
    }
    marriage = opts.at;
  } else {
    if (latestYear < minYear) {
      return null;
    }
    marriage = randomDate(
      Math.min(minYear + rng.int(0, 9), latestYear, CURRENT_YEAR - 1),
    );
  }
  const marriageYear = marriage.y;
  const husbandLike = a.sex === "F" && b.sex !== "F" ? b : a;
  const wifeLike = husbandLike === a ? b : a;
  const kind = opts.kind ?? "married";
  const region =
    husbandLike.homePlace?.region ?? wifeLike.homePlace?.region ?? "ma";
  const place = pickPlaceNear(
    husbandLike.homePlace?.name ?? wifeLike.homePlace?.name,
    region,
    marriageYear,
  );
  const f = newFamily({
    partner1: husbandLike,
    partner2: wifeLike,
    role1: husbandLike.sex === "F" ? "WIFE" : "HUSB",
    role2: wifeLike.sex === "M" ? "HUSB" : "WIFE",
    kind,
    marriage: kind === "partnership" ? null : marriage,
    marriagePlace: place,
    started: marriage,
  });
  f.homePlace = place;

  // Married surname for a wife: nearly universal before 1990, common after.
  if (
    kind !== "partnership" &&
    wifeLike.sex === "F" &&
    husbandLike.sex === "M" &&
    rng.chance(marriageYear < 1990 ? 0.96 : 0.7)
  ) {
    // GEDCOM writers record this either way round: usually the birth name
    // as primary with a `married` record, sometimes the married name as
    // primary with a `maiden` record. The tree card handles both, so the
    // seed carries both -- but only on a first marriage, so a remarriage
    // does not stack a second primary-name swap.
    if (
      wifeLike.names.some((n) => n.type === "married" || n.type === "maiden")
    ) {
      wifeLike.names.push({
        type: "married",
        given: wifeLike.given,
        surname: husbandLike.surname,
      });
    } else if (rng.chance(0.3)) {
      wifeLike.names.push({
        type: "maiden",
        given: wifeLike.given,
        surname: wifeLike.surname,
      });
      wifeLike.surname = husbandLike.surname;
    } else {
      wifeLike.names.push({
        type: "married",
        given: wifeLike.given,
        surname: husbandLike.surname,
      });
    }
  }
  return f;
}

/** How the union ends, and when children stop. */
function settleEnding(f) {
  const a = f.partner1;
  const b = f.partner2;
  const start = f.started;
  let endBy = null; // the date children stop coming
  const deaths = [a, b].map((p) => p?.death ?? null).filter((d) => d !== null);
  if (deaths.length > 0) {
    endBy = deaths.reduce((m, d) => (compareDates(d, m) < 0 ? d : m));
  }
  if (f.kind === "married") {
    const divorceChance = start.y < 1900 ? 0.02 : start.y < 1960 ? 0.08 : 0.24;
    if (rng.chance(divorceChance)) {
      const yearsIn = rng.int(2, 22);
      const when = addYears(start, yearsIn, 4);
      if (endBy === null || compareDates(when, endBy) < 0) {
        if (when.y < CURRENT_YEAR) {
          f.ended = { type: "DIV", date: when };
          endBy = when;
        }
      }
    }
  }
  f.childrenUntil = endBy;
  return f;
}

/** Generate the children of a family into the next generation. */
function makeChildren(f, gen, budget) {
  const mother =
    f.partner2?.sex === "F"
      ? f.partner2
      : f.partner1?.sex === "F"
        ? f.partner1
        : (f.partner2 ?? f.partner1);
  const father = mother === f.partner1 ? f.partner2 : f.partner1;
  const start = f.started;
  let count = Math.min(childCountFor(start.y), budget.left());
  if (f.kind === "partnership") {
    count = Math.min(count, 2);
  }
  let next = addYears(start, rng.chance(0.12) ? 0 : 1, 3);
  if (compareDates(next, start) <= 0) {
    next = addYears(start, 1);
  }
  const surname =
    father !== null && father.sex === "M"
      ? father.surname
      : (mother?.surname ?? father?.surname ?? "Unknown");
  const line = father?.line ?? mother?.line ?? null;
  const children = [];
  for (let i = 0; i < count; i++) {
    if (next.y >= CURRENT_YEAR - 1) {
      break;
    }
    if (mother !== null && ageAt(mother.birth, next) > 44) {
      break;
    }
    if (f.childrenUntil !== null && compareDates(next, f.childrenUntil) > 0) {
      break;
    }
    const twins = rng.chance(0.02);
    const born = next;
    const n = twins ? 2 : 1;
    for (let t = 0; t < n; t++) {
      const sex = rng.chance(0.51) ? "M" : "F";
      const child = newPerson({
        sex,
        gen,
        line,
        surname,
        birthSurname: surname,
        birth: born,
        birthPlace: f.homePlace,
        homePlace: f.homePlace,
        religion: father?.religion ?? mother?.religion ?? null,
        nationality: "American",
        ethnic: father?.ethnic ?? mother?.ethnic ?? null,
      });
      if (twins) {
        child.tags.add("twin");
      }
      setupNameBits(
        child,
        father !== null && father.sex === "M" ? father : null,
      );
      assignDeath(child);
      addChild(f, child);
      children.push(child);
    }
    next = addYears(next, rng.int(1, 4), 3);
  }
  return children;
}

const budget = {
  /** Soft ceiling: past the target, families shrink to at most one child. */
  left() {
    return persons.length < TARGET_PERSONS
      ? 12
      : persons.length < TARGET_PERSONS * 1.25
        ? 1
        : 0;
  },
};

// --- founders ----------------------------------------------------------------

const generations = new Map(); // gen -> tree-born persons

function pushGen(gen, p) {
  if (!generations.has(gen)) {
    generations.set(gen, []);
  }
  generations.get(gen).push(p);
}

for (const line of LINES) {
  const husband = newPerson({
    sex: "M",
    gen: 1,
    line,
    surname: line.surname,
    birthSurname: line.birthSurname ?? line.surname,
    birth: randomDate(line.foundersBorn + rng.int(-2, 2)),
    birthPlace: line.origin,
    homePlace: line.settled,
    religion: line.religion,
    nationality: line.nationality,
    ethnic: line.ethnic,
    tags: new Set(["founder"]),
  });
  const wife = newPerson({
    sex: "F",
    gen: 1,
    line,
    surname: null,
    birth: randomDate(line.foundersBorn + rng.int(0, 5)),
    birthPlace: line.origin,
    homePlace: line.settled,
    religion: line.religion,
    nationality: line.nationality,
    ethnic: line.ethnic,
    tags: new Set(["founder"]),
  });
  wife.surname = rng.pick(MARRY_IN_SURNAMES);
  wife.birthSurname = wife.surname;
  setupNameBits(husband, null);
  setupNameBits(wife, null);
  if (line.anglicize !== undefined) {
    // The name as written in the old country, kept as a `birth` name; the
    // primary name is the anglicised form the family used after arrival.
    for (const p of [husband, wife]) {
      const angl = line.anglicize[p.given];
      const surnameChanged = p.birthSurname !== p.surname;
      if (angl !== undefined || surnameChanged) {
        p.names.push({
          type: "birth",
          given: p.given,
          surname: p.birthSurname,
        });
        p.given = angl ?? p.given;
        p.tags.add("anglicized");
      }
    }
  }
  if (line.arrival !== null) {
    husband.tags.add("immigrant");
    wife.tags.add("immigrant");
  }
  assignDeath(husband, { adult: true });
  assignDeath(wife, { adult: true });
  pushGen(1, husband);
  pushGen(1, wife);

  const f = unite(husband, wife);
  f.tags = new Set(["founding"]);
  settleEnding(f);
  line.foundingFamily = f;

  // Generation 0: the founder's parents for the lines with an old-calendar story.
  if (line.gen0 !== null) {
    const gf = newPerson({
      sex: "M",
      gen: 0,
      line,
      surname: line.surname,
      birthSurname: line.surname,
      // The dual-year line's parents are born before 1752 on purpose.
      birth: randomDate(
        line.foundersBorn -
          (line.gen0 === "dual" ? rng.int(31, 36) : rng.int(26, 34)),
      ),
      birthPlace: line.origin,
      homePlace: line.origin,
      religion: line.religion,
      nationality: line.nationality,
      ethnic: line.ethnic,
      tags: new Set(["gen0", line.gen0]),
    });
    const gm = newPerson({
      sex: "F",
      gen: 0,
      line,
      surname: rng.pick(MARRY_IN_SURNAMES),
      birth: randomDate(line.foundersBorn - rng.int(22, 30)),
      birthPlace: line.origin,
      homePlace: line.origin,
      religion: line.religion,
      nationality: line.nationality,
      ethnic: line.ethnic,
      tags: new Set(["gen0", line.gen0]),
    });
    gm.birthSurname = gm.surname;
    if (line.gen0 === "dual") {
      // Force Jan–Mar births so the 1749/50 dual-year form appears.
      gf.birth = date(gf.birth.y, rng.int(1, 3), rng.int(1, 24));
      gm.birth = date(gm.birth.y, rng.int(1, 3), rng.int(1, 24));
    }
    setupNameBits(gf, null);
    setupNameBits(gm, null);
    gf.death = addYears(gf.birth, rng.int(55, 80), 6);
    gm.death = addYears(gm.birth, rng.int(50, 82), 6);
    gf.cause = rng.pick(DEATH_CAUSES);
    gm.cause = rng.pick(DEATH_CAUSES);
    const f0 = unite(gf, gm);
    if (line.gen0 === "french") {
      // The Republican calendar ran 1792–1805; put the marriage inside it.
      const wed = randomDate(Math.min(husband.birth.y - rng.int(1, 5), 1805));
      f0.started = wed;
      f0.marriage = wed;
      f0.frenchMarriage = true;
    }
    settleEnding(f0);
    addChild(f0, husband);
    // A sibling or two so gen 0 is not a bare couple.
    for (let i = 0; i < rng.int(1, 2); i++) {
      const sib = newPerson({
        sex: rng.chance(0.5) ? "M" : "F",
        gen: 1,
        line,
        surname: line.surname,
        birthSurname: line.surname,
        birth: addYears(husband.birth, rng.int(-6, -2), 4),
        birthPlace: line.origin,
        homePlace: line.origin,
        religion: line.religion,
        nationality: line.nationality,
        ethnic: line.ethnic,
      });
      setupNameBits(sib, gf);
      assignDeath(sib);
      addChild(f0, sib);
      pushGen(1, sib);
    }
    pushGen(0, gf);
    pushGen(0, gm);
  }
}

// --- generations 1..N --------------------------------------------------------

let cousinMarriageDone = false;
let sameSexDone = 0;
let annulmentDone = false;
let tripleMarriageDone = false;
let widowRemarriedDone = 0;

// Everyone born into the tree is processed in birth order, so a person's
// spouse pool is the people alive around them, whatever their line's
// "generation" number happens to be (the lines start a century apart).
/**
 * Share of people whose descendants the tree follows, by birth year. The
 * knob that sets the tree's size; `--trace a,b,c,d` overrides it.
 */
const TRACE_RATES = String(argValue("--trace", "0.5,0.5,0.75,0.9"))
  .split(",")
  .map(Number);
function traceRate(year) {
  if (year < 1860) {
    return TRACE_RATES[0];
  }
  if (year < 1920) {
    return TRACE_RATES[1];
  }
  if (year < 1960) {
    return TRACE_RATES[2];
  }
  return TRACE_RATES[3];
}

const queue = persons.filter((p) => p.famc !== null || p.tags.has("founder"));
const done = new Set();
for (;;) {
  const pending = queue.filter((q) => !done.has(q));
  if (pending.length === 0) {
    break;
  }
  pending.sort((a, b) => compareDates(a.birth, b.birth));
  const p = pending[0];
  done.add(p);
  const gen = p.gen;
  {
    if (p.tags.has("founder")) {
      // Founders are already paired: just their children.
      if (p.sex === "M") {
        const kids = makeChildren(p.line.foundingFamily, gen + 1, budget);
        for (const k of kids) {
          pushGen(gen + 1, k);
          queue.push(k);
        }
      }
      continue;
    }
    if (p.tags.has("paired")) {
      continue;
    }
    if (p.death !== null && ageAt(p.birth, p.death) < 19) {
      continue; // died young
    }
    if (p.birth.y > CURRENT_YEAR - 22) {
      continue; // too young
    }
    // A real tree follows a few lines closely and leaves the rest as
    // "married, had issue, not traced". Without this the 1850s cohorts eat
    // the whole budget and nobody is born after 1940.
    if (!rng.chance(traceRate(p.birth.y))) {
      p.tags.add("untraced");
      continue;
    }
    p.tags.add("paired");

    // A same-sex couple, twice, in the modern cohorts.
    if (p.birth.y >= 1958 && sameSexDone < 2 && rng.chance(0.08)) {
      sameSexDone += 1;
      const partner = marryIn(
        p.sex,
        p.birth.y + rng.int(-4, 4),
        p.homePlace.region,
      );
      partner.tags.add("paired");
      const wedYear = Math.max(
        Math.max(p.birth.y, partner.birth.y) + rng.int(22, 34),
        2004,
      );
      const f = unite(p, partner, { kind: "married", at: randomDate(wedYear) });
      if (f === null) {
        dropUnpairedMarryIn(partner);
        continue;
      }
      f.tags = new Set(["same-sex"]);
      settleEnding(f);
      // Adopted children, one or two.
      const n = rng.int(1, 2);
      let born = addYears(f.started, 1, 6);
      for (let i = 0; i < n && born.y < CURRENT_YEAR - 1; i++) {
        const child = newPerson({
          sex: rng.chance(0.5) ? "M" : "F",
          gen: gen + 1,
          line: p.line,
          surname: p.surname,
          birthSurname: p.surname,
          birth: born,
          birthPlace: f.homePlace,
          homePlace: f.homePlace,
          religion: p.religion,
          nationality: "American",
          ethnic: p.ethnic,
        });
        setupNameBits(child, null);
        child.adopted = { by: f, date: addYears(born, rng.int(0, 2), 3) };
        addChild(f, child, { p1: "adopted", p2: "adopted" });
        pushGen(gen + 1, child);
        queue.push(child);
        born = addYears(born, rng.int(2, 4));
      }
      continue;
    }

    // Never married (but perhaps a single parent).
    const neverMarried = rng.chance(p.birth.y < 1900 ? 0.09 : 0.13);
    if (neverMarried) {
      if (p.sex === "F" && p.birth.y >= 1880 && rng.chance(0.25)) {
        // Single mother: a family with one partner.
        const born = addYears(p.birth, rng.int(19, 32), 6);
        if (born.y < CURRENT_YEAR - 1 && isAlive(p, born)) {
          const f = newFamily({
            partner1: p,
            partner2: null,
            role1: "WIFE",
            role2: null,
            kind: "unknown",
            marriage: null,
            started: addYears(born, -1),
            homePlace: p.homePlace,
          });
          f.tags = new Set(["single-parent"]);
          f.childrenUntil = null;
          const child = newPerson({
            sex: rng.chance(0.5) ? "M" : "F",
            gen: gen + 1,
            line: p.line,
            surname: p.surname,
            birthSurname: p.surname,
            birth: born,
            birthPlace: p.homePlace,
            homePlace: p.homePlace,
            religion: p.religion,
            nationality: "American",
            ethnic: p.ethnic,
          });
          setupNameBits(child, null);
          assignDeath(child);
          addChild(f, child);
          pushGen(gen + 1, child);
          queue.push(child);
        }
      }
      continue;
    }

    // First union.
    let spouse = null;
    const wantsCousin =
      !cousinMarriageDone && p.birth.y >= 1850 && p.birth.y < 1900;
    if (wantsCousin) {
      spouse =
        pending.find(
          (q) =>
            q !== p &&
            !q.tags.has("paired") &&
            q.sex !== p.sex &&
            Math.abs(q.birth.y - p.birth.y) <= 8 &&
            (q.death === null || ageAt(q.birth, q.death) > 20) &&
            areFirstCousins(p, q),
        ) ?? null;
      if (spouse !== null) {
        cousinMarriageDone = true;
        spouse.tags.add("paired");
      }
    }
    if (spouse === null && rng.chance(0.22)) {
      spouse =
        pending.find(
          (q) =>
            q !== p &&
            !q.tags.has("paired") &&
            q.sex !== p.sex &&
            Math.abs(q.birth.y - p.birth.y) <= 7 &&
            (q.death === null || ageAt(q.birth, q.death) > 20) &&
            !related(p, q),
        ) ?? null;
      if (spouse !== null) {
        spouse.tags.add("paired");
      }
    }
    if (spouse === null) {
      spouse = marryIn(
        p.sex === "M" ? "F" : "M",
        p.birth.y + rng.int(-3, 5),
        p.homePlace.region,
      );
      spouse.tags.add("paired");
    }
    const kind =
      p.birth.y >= 1950 && rng.chance(0.07) ? "partnership" : "married";
    const f1 = unite(p, spouse, { kind });
    if (f1 === null) {
      dropUnpairedMarryIn(spouse);
      continue;
    }
    if (wantsCousin && spouse.famc !== null && areFirstCousins(p, spouse)) {
      f1.tags = new Set(["cousin-marriage"]);
    }
    if (
      !annulmentDone &&
      f1.kind === "married" &&
      f1.started.y >= 1900 &&
      f1.started.y < 1980 &&
      rng.chance(0.1)
    ) {
      annulmentDone = true;
      f1.ended = { type: "ANUL", date: addYears(f1.started, 1, 4) };
      f1.childrenUntil = f1.ended.date;
      f1.tags = new Set(["annulled"]);
    } else {
      settleEnding(f1);
    }
    const kids1 = makeChildren(f1, gen + 1, budget);
    for (const k of kids1) {
      pushGen(gen + 1, k);
      queue.push(k);
    }

    // Second (and third) unions after divorce or widowhood.
    const firstEnded = f1.ended?.date ?? null;
    const widowed =
      spouse.death !== null &&
      isAlive(p, spouse.death) &&
      ageAt(p.birth, spouse.death) < 60 &&
      (firstEnded === null || compareDates(spouse.death, firstEnded) < 0);
    const unionEnd = firstEnded ?? (widowed ? spouse.death : null);
    if (
      unionEnd !== null &&
      isAlive(p, unionEnd) &&
      unionEnd.y < CURRENT_YEAR - 2
    ) {
      const remarryChance = widowed ? 0.55 : 0.6;
      if (rng.chance(remarryChance)) {
        if (widowed) {
          widowRemarriedDone += 1;
        }
        const s2 = marryIn(
          p.sex === "M" ? "F" : "M",
          p.birth.y + rng.int(-6, 8),
          p.homePlace.region,
        );
        s2.tags.add("paired");
        // The second marriage comes after the first ended, and after p is
        // grown (a first spouse can die early).
        let after = addYears(unionEnd, rng.int(1, 5), 4);
        const grown = addYears(p.birth, 20);
        if (compareDates(after, grown) < 0) {
          after = grown;
        }
        const f2 = unite(p, s2, { kind: "married", at: after });
        if (f2 === null) {
          dropUnpairedMarryIn(s2);
          continue;
        }
        settleEnding(f2);
        // A child from the first marriage joins the new household as a
        // step-child of the new partner.
        if (kids1.length > 0 && rng.chance(0.6)) {
          const stepKid = kids1[0];
          const rel =
            f2.partner1 === p
              ? { p1: "biological", p2: "step" }
              : { p1: "step", p2: "biological" };
          f2.children.push({ person: stepKid, relation: rel });
        }
        const kids2 = makeChildren(f2, gen + 1, budget);
        for (const k of kids2) {
          pushGen(gen + 1, k);
          queue.push(k);
        }
        // One person marries three times.
        if (
          !tripleMarriageDone &&
          f2.ended !== null &&
          isAlive(p, f2.ended.date) &&
          f2.ended.date.y < CURRENT_YEAR - 3
        ) {
          tripleMarriageDone = true;
          const s3 = marryIn(
            p.sex === "M" ? "F" : "M",
            p.birth.y + rng.int(-8, 10),
            p.homePlace.region,
          );
          s3.tags.add("paired");
          const after3 = addYears(f2.ended.date, rng.int(1, 4), 4);
          const f3 = unite(p, s3, { kind: "married", at: after3 });
          if (f3 === null) {
            dropUnpairedMarryIn(s3);
          } else {
            f3.childrenUntil = null;
            f3.tags = new Set(["third-marriage"]);
          }
        }
      }
    }
  }
}

// --- special children: adopted, foster, guardian, sealed --------------------

{
  const candidates = families.filter(
    (f) =>
      f.kind === "married" &&
      f.partner1 !== null &&
      f.partner2 !== null &&
      f.started.y >= 1900 &&
      f.started.y < 2010,
  );
  const specials = [
    ["adopted", "adopted"],
    ["adopted", "adopted"],
    ["foster", "foster"],
    ["guardian", "guardian"],
    ["sealed", "sealed"],
  ];
  let i = 7;
  for (const [rel] of specials) {
    const f = candidates[i % candidates.length];
    i += 13;
    const born = addYears(f.started, rng.int(3, 9), 5);
    if (born.y >= CURRENT_YEAR - 1) {
      continue;
    }
    const child = newPerson({
      sex: rng.chance(0.5) ? "M" : "F",
      gen: Math.max(f.partner1.gen, f.partner2.gen) + 1,
      line: f.partner1.line ?? f.partner2.line,
      surname:
        rel === "foster" ? rng.pick(MARRY_IN_SURNAMES) : f.partner1.surname,
      birth: born,
      birthPlace: f.homePlace,
      homePlace: f.homePlace,
      religion: f.partner1.religion,
      nationality: "American",
      ethnic: null,
      tags: new Set([rel]),
    });
    child.birthSurname = child.surname;
    setupNameBits(child, null);
    assignDeath(child);
    if (rel === "adopted") {
      child.adopted = { by: f, date: addYears(born, rng.int(0, 3), 4) };
    }
    addChild(f, child, { p1: rel, p2: rel });
  }
}

// --- an unlinked stray family, and people of unknown / other sex -----------

{
  const strayFather = newPerson({
    sex: "M",
    gen: 5,
    line: null,
    surname: "Whitlock",
    birthSurname: "Whitlock",
    birth: date(1931, 4, 2),
    birthPlace: { name: "Bangor, Penobscot, Maine, USA", region: "ma" },
    homePlace: { name: "Bangor, Penobscot, Maine, USA", region: "ma" },
    religion: "protestant",
    nationality: "American",
    ethnic: "English",
    tags: new Set(["stray"]),
  });
  strayFather.given = "Walter";
  const strayMother = newPerson({
    sex: "F",
    gen: 5,
    line: null,
    surname: "Gray",
    birthSurname: "Gray",
    birth: date(1934, 11, 19),
    birthPlace: strayFather.homePlace,
    homePlace: strayFather.homePlace,
    religion: "protestant",
    nationality: "American",
    ethnic: "Scottish",
    tags: new Set(["stray"]),
  });
  strayMother.given = "Florence";
  assignDeath(strayFather);
  assignDeath(strayMother);
  const sf = unite(strayFather, strayMother);
  sf.tags = new Set(["stray"]);
  settleEnding(sf);
  const strayChild = newPerson({
    sex: null, // no SEX line at all → `unknown`
    gen: 6,
    line: null,
    surname: "Whitlock",
    birthSurname: "Whitlock",
    birth: date(1961, 7, 30),
    birthPlace: strayFather.homePlace,
    homePlace: strayFather.homePlace,
    religion: "protestant",
    nationality: "American",
    ethnic: "English",
    tags: new Set(["stray"]),
  });
  strayChild.given = "Harold";
  addChild(sf, strayChild);
}

{
  // One person of `other` sex, born into the tree in the modern era.
  const modern = persons.filter(
    (p) =>
      p.famc !== null &&
      p.birth.y >= 1990 &&
      p.birth.y <= 2004 &&
      !p.tags.has("paired"),
  );
  const x = modern[modern.length - 1];
  if (x !== undefined) {
    x.sex = "X";
    x.given = "Riley";
    x.tags.add("sex-other");
  }
}

// ---------------------------------------------------------------------------
// Enrichment: events, facts, notes, citations, media for every record
// ---------------------------------------------------------------------------

let refnCounter = 0;
function nextRefn() {
  refnCounter += 1;
  return `RW-${String(refnCounter).padStart(4, "0")}`;
}

function fsftid() {
  const letters = "ABCDEFGHJKLMNPQRSTVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += letters[rng.int(0, letters.length - 1)];
    if (i === 3) {
      s += "-";
    }
  }
  return s;
}

function afn() {
  const letters = "ABCDEFGHJKLMNPQRSTVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 7; i++) {
    s += letters[rng.int(0, letters.length - 1)];
    if (i === 3) {
      s += "-";
    }
  }
  return s;
}

function ssn() {
  return `${rng.int(100, 899)}-${String(rng.int(1, 99)).padStart(2, "0")}-${String(rng.int(1, 9999)).padStart(4, "0")}`;
}

function religiousEventsFor(p) {
  const out = [];
  const b = p.birth;
  const reached = (age) =>
    b.y + age < CURRENT_YEAR && isAlive(p, addYears(b, age));
  const place = p.birthPlace?.name ?? null;
  switch (p.religion) {
    case "catholic":
      out.push({ tag: "BAPM", date: after(b, 2), place });
      if (reached(8)) {
        out.push({ tag: "FCOM", date: addYears(b, 8, 3), place });
      }
      if (reached(13)) {
        out.push({ tag: "CONF", date: addYears(b, 13, 3), place });
      }
      break;
    case "protestant":
      out.push({ tag: "CHR", date: after(b, 2), place });
      break;
    case "lutheran":
      out.push({ tag: "BAPM", date: after(b, 2), place });
      if (reached(15)) {
        out.push({ tag: "CONF", date: addYears(b, 15, 3), place });
      }
      break;
    case "orthodox":
      out.push({ tag: "CHR", date: after(b, 3), place });
      break;
    case "jewish":
      if (reached(13)) {
        out.push({
          tag: p.sex === "F" ? "BASM" : "BARM",
          date: addYears(b, p.sex === "F" ? 12 : 13, 0),
          place,
          hebrew: true,
        });
      }
      break;
    default:
      break;
  }
  return out;
}

function lifeEventsFor(p) {
  const out = [];
  const b = p.birth;
  // Alive at that age, and the date has already come.
  const alive = (age) =>
    b.y + age < CURRENT_YEAR && isAlive(p, addYears(b, age));
  const home = p.homePlace?.name ?? null;

  if (alive(18) && b.y >= 1890 && rng.chance(0.55)) {
    out.push({
      tag: "GRAD",
      date: addYears(b, 18, 1),
      place: home,
      value: "High school diploma",
    });
    if (alive(22) && b.y >= 1920 && rng.chance(0.45)) {
      out.push({
        tag: "GRAD",
        date: addYears(b, 22, 1),
        place: home,
        value: rng.pick(["B.A.", "B.S.", "Nursing diploma", "M.Ed.", "J.D."]),
      });
    }
  }
  if (p.tags.has("immigrant") && p.line !== null && p.line.arrival !== null) {
    const arrival = date(p.line.arrival, rng.int(3, 10), rng.int(1, 28));
    out.push({
      tag: "EMIG",
      date: addYears(arrival, 0, -1),
      place: p.line.origin.name,
    });
    out.push({
      tag: "IMMI",
      date: arrival,
      place: rng.pick([
        "Boston, Suffolk, Massachusetts, USA",
        "New York, New York, New York, USA",
      ]),
      source:
        p.line.arrival < 1892 ? SOURCE_BY_ROLE.manifests : SOURCE_BY_ROLE.ellis,
      note: `Arrived aboard the ${rng.pick(["SS Cephalonia", "SS Kaiser Wilhelm", "SS Saxonia", "SS Patria", "SS Kroonland"])}.`,
    });
    if (alive(p.line.arrival - b.y + 7)) {
      out.push({
        tag: "NATU",
        date: addYears(arrival, rng.int(5, 9), 5),
        place: p.line.settled.name,
      });
    }
  }
  for (const y of CENSUS_YEARS) {
    if (y > b.y && alive(y - b.y) && rng.chance(0.5)) {
      out.push({
        tag: "CENS",
        date: date(y, y >= 1930 ? 4 : 6, 1),
        place: home,
        source: CENSUS_SOURCES.get(y),
        age: `${y - b.y}y`,
      });
    }
  }
  if (alive(30) && rng.chance(0.7)) {
    out.push({
      tag: "RESI",
      date: {
        from: b.y + rng.int(22, 30),
        to: Math.min(b.y + rng.int(31, 50), p.death?.y ?? CURRENT_YEAR),
      },
      place: pickPlaceNear(home, p.homePlace?.region ?? "ma", b.y + 30).name,
    });
  }
  if (
    p.sex === "M" &&
    b.y >= 1912 &&
    b.y <= 1927 &&
    alive(30) &&
    rng.chance(0.6)
  ) {
    out.push({
      tag: "EVEN",
      type: "Military service",
      date: { from: 1942, to: 1945 },
      place: "Fort Devens, Middlesex, Massachusetts, USA",
      source: SOURCE_BY_ROLE.military,
      value: rng.pick([
        "U.S. Army, Private",
        "U.S. Navy, Seaman",
        "U.S. Army Air Forces, Sergeant",
      ]),
    });
  }
  if (alive(66) && b.y >= 1890 && rng.chance(0.5)) {
    out.push({ tag: "RETI", date: addYears(b, 65, 6), place: home });
  }
  if (p.death !== null && ageAt(b, p.death) > 40 && rng.chance(0.3)) {
    out.push({
      tag: "WILL",
      date: addYears(p.death, -rng.int(1, 6), 6),
      place: home,
    });
    out.push({ tag: "PROB", date: after(p.death, 6), place: home });
  }
  if (p.tags.has("sealed") && p.famc !== null) {
    out.push({
      tag: "EVEN",
      type: "Sealing to parents",
      date: addYears(b, 2, 4),
      place: "Salt Lake City, Salt Lake, Utah, USA",
    });
  }
  return out;
}

function factsFor(p) {
  const out = [];
  const b = p.birth;
  const adult = p.death === null || ageAt(b, p.death) >= 18;
  if (adult) {
    const occ = rng.pick(OCCUPATIONS[eraKey(b.y, OCCUPATIONS)]);
    out.push({
      tag: "OCCU",
      value: occ,
      date: {
        from: b.y + rng.int(16, 24),
        to: Math.min(b.y + rng.int(45, 67), p.death?.y ?? CURRENT_YEAR),
      },
      place: p.homePlace?.name ?? null,
    });
    if (rng.chance(0.25)) {
      out.push({
        tag: "OCCU",
        value: rng.pick(OCCUPATIONS[eraKey(b.y, OCCUPATIONS)]),
        date: date(b.y + rng.int(25, 40)),
      });
    }
  }
  if (p.religion !== null) {
    out.push({
      tag: "RELI",
      value: {
        catholic: "Roman Catholic",
        protestant: "Congregationalist",
        lutheran: "Lutheran",
        orthodox: "Greek Orthodox",
        jewish: "Jewish",
      }[p.religion],
    });
  }
  if (p.nationality !== null) {
    out.push({ tag: "NATI", value: p.nationality });
  }
  if (adult && b.y >= 1880 && rng.chance(0.5)) {
    out.push({
      tag: "EDUC",
      value: rng.pick([
        "Grammar school",
        "High school",
        "Bachelor's degree",
        "Master's degree",
        "Trade apprenticeship",
        "Doctorate",
      ]),
    });
  }
  if (rng.chance(0.35)) {
    out.push({
      tag: "DSCR",
      value: `${rng.pick(["Tall", "Short", "Slight", "Stout", "Broad-shouldered"])}, ${rng.pick(EYE_COLOURS)} eyes, ${rng.pick(HAIR_COLOURS)} hair`,
    });
  }
  if (rng.chance(0.3)) {
    out.push({ tag: "FACT", type: "Eye color", value: rng.pick(EYE_COLOURS) });
  }
  if (rng.chance(0.3)) {
    out.push({
      tag: "FACT",
      type: "Hair color",
      value: rng.pick(HAIR_COLOURS),
    });
  }
  if (adult && rng.chance(0.2)) {
    out.push({
      tag: "FACT",
      type: "Height",
      value: `${rng.int(4, 6)} ft ${rng.int(0, 11)} in`,
    });
  }
  if (adult && rng.chance(0.1)) {
    out.push({ tag: "FACT", type: "Weight", value: `${rng.int(100, 240)} lb` });
  }
  if (p.ethnic !== null && rng.chance(0.4)) {
    out.push({ tag: "FACT", type: "Ethnic origin", value: p.ethnic });
  }
  if (adult && b.y < 1930 && rng.chance(0.15)) {
    out.push({
      tag: "PROP",
      value: rng.pick([
        "Farm of 80 acres",
        "House and lot on Main Street",
        "Two-family house",
        "A quarter section in Goodhue County",
      ]),
      date: date(b.y + rng.int(30, 50)),
    });
  }
  if (
    adult &&
    b.y >= 1936 &&
    p.nationality === "American" &&
    p.death === null &&
    rng.chance(0.5)
  ) {
    out.push({ tag: "SSN", value: ssn() });
  }
  if (p.tags.has("immigrant") && rng.chance(0.6)) {
    out.push({
      tag: "IDNO",
      type: "Passport",
      value: `${rng.pick(["A", "B", "K"])}${rng.int(100000, 999999)}`,
    });
  }
  if (adult && rng.chance(0.08)) {
    out.push({
      tag: "FACT",
      type: "Medical",
      value: rng.pick([
        "Diabetic from age 50",
        "Hay fever",
        "Wore spectacles from childhood",
        "Rheumatism in later life",
      ]),
    });
  }
  return out;
}

function bioFor(p) {
  const pr = pronouns(p);
  const n = rng.int(1, 3);
  const lines = [];
  const used = new Set();
  const pool = p.tags.has("immigrant")
    ? [...BIO_SENTENCES, ...IMMIGRANT_BIO_SENTENCES]
    : BIO_SENTENCES;
  for (let i = 0; i < n; i++) {
    let s = rng.pick(pool);
    while (used.has(s)) {
      s = rng.pick(pool);
    }
    used.add(s);
    lines.push(
      s
        .replace("{pronoun_pos}", pr.pos)
        .replace("{language}", LANGUAGE_FOR_LINE[p.line?.key] ?? "English"),
    );
  }
  return lines.join("\n");
}

const LORE_NOTE = {
  id: 1,
  xref: "@N1@",
  text:
    "Every person in this tree is fictional. The Rootward demo generator\n" +
    "(scripts/demo-tree/generate.mjs) built it to exercise every field the\n" +
    "site can show. Any resemblance to a real family is coincidental.",
};
const CROSSING_NOTE = {
  id: 2,
  xref: "@N2@",
  text:
    "Family lore says the crossing took nine weeks and that the youngest\n" +
    "child was born at sea. No manifest confirms it.",
};
const NAMING_NOTE = {
  id: 3,
  xref: "@N3@",
  text: "The spelling of the surname was changed at the port of entry and never changed back.",
};
sharedNotes.push(LORE_NOTE, CROSSING_NOTE, NAMING_NOTE);

function portraitFor(p) {
  const b = p.birth;
  let taken = addYears(b, rng.int(22, 45), 6);
  if (p.death !== null && compareDates(taken, p.death) > 0) {
    taken = addYears(p.death, -rng.int(1, 3), 6);
  }
  if (taken.y > CURRENT_YEAR - 1) {
    taken = date(CURRENT_YEAR - 1, rng.int(1, 12), rng.int(1, 28));
  }
  const painted = taken.y < FIRST_PHOTO_YEAR;
  return newMedia("portrait", {
    title: painted
      ? `${fullName(p)}, painted portrait`
      : `${fullName(p)}, ${taken.y}`,
    date: painted
      ? { phrase: "a painted portrait, before photography" }
      : taken,
    mono: b.y < COLOUR_PHOTO_BIRTH_YEAR,
    note: rng.chance(0.3)
      ? rng.pick([
          "Studio portrait.",
          "Scanned from the family album.",
          "Copied from a cousin's collection in 2011.",
          "Original is badly faded.",
        ])
      : null,
  });
}

for (const p of persons) {
  p.refn = nextRefn();
  p.fsftid = fsftid();
  if (p.birth.y < 1930) {
    p.afn = afn();
  }
  if (p.given === null) {
    p.given = givenNameFor(p.sex, p.birth.y, p.line);
  }

  // Name prefixes / extra names.
  if (p.sex === "M" && p.death !== null && rng.chance(0.03)) {
    p.prefix = rng.pick(["Dr.", "Rev.", "Capt.", "Hon."]);
  }
  if (p.tags.has("immigrant") && p.line?.key === "kowalczyk" && p.sex === "M") {
    p.names.push({ type: "immigrant", given: "Stanley", surname: "Kowalski" });
  }
  if (p.tags.has("immigrant") && p.line?.key === "papadakis") {
    p.names.push({ type: "also_known_as", given: p.given, surname: "Pappas" });
  }
  if (rng.chance(0.04)) {
    p.names.push({
      type: "also_known_as",
      given: p.given,
      surname: p.surname,
      nick: rng.pick(["Sonny", "Bud", "Sis", "Junior", "Red", "Dolly"]),
    });
  }
  if (p.nick !== null && rng.chance(0.15)) {
    p.names.push({ type: "nickname", given: p.nick, surname: p.surname });
  }
  if (
    p.sex === "F" &&
    p.religion === "catholic" &&
    p.death !== null &&
    !p.tags.has("paired") &&
    p.fams.length === 0 &&
    ageAt(p.birth, p.death) > 30 &&
    !p.tags.has("religious-done") &&
    persons.filter((q) => q.tags.has("religious")).length < 2
  ) {
    p.tags.add("religious");
    p.names.push({
      type: "religious",
      given: `Sister Mary ${rng.pick(["Agnes", "Clare", "Bernadette"])}`,
      surname: null,
      prefix: "Sr.",
    });
  }

  // Facts and events.
  p.facts = factsFor(p);
  p.events = [...religiousEventsFor(p), ...lifeEventsFor(p)];
  if (p.adopted !== undefined) {
    p.events.push({
      tag: "ADOP",
      date: p.adopted.date,
      place: p.adopted.by.homePlace?.name ?? null,
      famc: p.adopted.by,
    });
  }

  // Notes and citations.
  p.notes.push({ text: bioFor(p) });
  if (p.tags.has("untraced")) {
    p.notes.push({
      text: "Married and had issue; this line is not traced further.",
    });
  }
  if (p.tags.has("founder") || p.tags.has("gen0")) {
    p.notes.push({ shared: LORE_NOTE });
  }
  if (p.tags.has("immigrant")) {
    p.notes.push({ shared: CROSSING_NOTE });
  }
  if (p.tags.has("anglicized")) {
    p.notes.push({ shared: NAMING_NOTE });
  }
  if (rng.chance(0.2)) {
    p.citations.push(
      citation(SOURCE_BY_ROLE.obituaries, `clipping ${rng.int(1, 400)}`, {
        dataText: `${fullName(p)}, of ${p.homePlace?.name ?? "this city"}.`,
      }),
    );
  }

  // Media.
  const portrait = portraitFor(p);
  p.media.push({ record: portrait, primary: true });
  if (rng.chance(0.12)) {
    const extra = newMedia("photo", {
      title: `${fullName(p)} with family, ${p.birth.y + rng.int(5, 40)}`,
      date: date(p.birth.y + rng.int(5, 40)),
      mono: p.birth.y < COLOUR_PHOTO_BIRTH_YEAR,
    });
    p.media.push({ record: extra, primary: false });
  }
}

// Families: events, media, notes, citations.
for (const f of families) {
  const region = f.homePlace?.region ?? "ma";
  const place = f.marriagePlace?.name ?? f.homePlace?.name ?? null;
  if (f.marriage !== null) {
    if (f.started.y < 1900 && rng.chance(0.3)) {
      f.events.push({ tag: "MARB", date: addYears(f.marriage, 0, -1), place });
    }
    if (f.started.y >= 1900 && rng.chance(0.35)) {
      f.events.push({ tag: "ENGA", date: addYears(f.marriage, -1, 3), place });
    }
    f.events.push({
      tag: "MARR",
      date: f.marriage,
      place,
      source: CHURCH_SOURCE_FOR_REGION[region] ?? SOURCE_BY_ROLE.maVital,
      exactDate: true,
      french: f.frenchMarriage === true,
      media: f.tags?.has("founding")
        ? // A "scanned" marriage record, so PDFs go through the pipeline too.
          newMedia("document", {
            title: `Marriage record of ${fullName(f.partner1)} and ${fullName(f.partner2)}, ${f.marriage.y}`,
            date: f.marriage,
            lines: [
              "MARRIAGE REGISTER",
              "",
              `${fullName(f.partner1)} and ${fullName(f.partner2)}`,
              `Married ${fmtExact(f.marriage)}`,
              place ?? "",
            ],
          })
        : rng.chance(0.55) && f.marriage.y >= FIRST_PHOTO_YEAR
          ? newMedia("photo", {
              title: `Wedding of ${fullName(f.partner1)} and ${fullName(f.partner2)}, ${f.marriage.y}`,
              date: f.marriage,
              mono: f.marriage.y < 1955,
            })
          : null,
    });
  }
  if (f.ended !== null) {
    f.events.push({
      tag: f.ended.type,
      date: f.ended.date,
      place: f.homePlace?.name ?? null,
      exactDate: true,
    });
  }
  if (f.partner1 !== null && f.partner2 !== null && rng.chance(0.4)) {
    const y = f.started.y + rng.int(2, 15);
    if (y < CURRENT_YEAR) {
      f.events.push({
        tag: "RESI",
        date: date(y),
        place: f.homePlace?.name ?? null,
      });
    }
  }
  if (f.children.length > 0) {
    f.facts = [{ tag: "NCHI", value: String(f.children.length) }];
  }
  if (rng.chance(0.25)) {
    f.notes.push({
      text: rng.pick([
        "They met at a church social.",
        "Married in the bride's parents' front parlour.",
        "The wedding was postponed a year by the influenza.",
        "Second cousins once removed, by one account.",
      ]),
    });
  }
  if (f.tags?.has("cousin-marriage")) {
    f.notes.push({
      text: "First cousins: both are grandchildren of the same couple. The pedigree folds back on itself two generations up.",
    });
  }
}

// Person-level facts about the whole life, computed truthfully.
for (const p of persons) {
  const marriages = p.fams.filter((f) => f.marriage !== null).length;
  if (marriages > 0) {
    p.facts.push({ tag: "NMR", value: String(marriages) });
  }
  const kids = p.fams.reduce(
    (n, f) =>
      n +
      f.children.filter(
        (c) =>
          c.relation === null ||
          c.relation.p1 === "biological" ||
          c.relation.p2 === "biological" ||
          c.relation.p1 === "adopted",
      ).length,
    0,
  );
  if (kids > 0) {
    p.facts.push({ tag: "NCHI", value: String(kids) });
  }
}

// The visibility ladder (#126): every rung on a few living people, and a
// hidden / moderators-only fact on two visible living people. Chosen by
// position, not by `rng`, so the rest of the tree is unchanged.
{
  const VISIBILITY_RUNGS = ["hidden", "moderators_only", "close_family"];
  const livingPeople = persons.filter((p) => p.death === null);
  livingPeople.forEach((p, i) => {
    if (i % 40 === 7) {
      p.visibility =
        VISIBILITY_RUNGS[Math.floor(i / 40) % VISIBILITY_RUNGS.length];
    }
  });
  const withFacts = livingPeople.filter(
    (p) => p.visibility === undefined && p.facts.length > 0,
  );
  const hiddenFact = withFacts[5]?.facts[0];
  if (hiddenFact !== undefined) {
    hiddenFact.visibility = "hidden";
  }
  const moderatorsFact = withFacts[11]?.facts[0];
  if (moderatorsFact !== undefined) {
    moderatorsFact.visibility = "moderators_only";
  }
}

// One title of nobility and one caste, for the two rarest fact types.
{
  const gen0 = persons.find((p) => p.tags.has("gen0") && p.sex === "M");
  if (gen0 !== undefined) {
    gen0.facts.push({ tag: "TITL", value: "Esquire" });
  }
  const founder = persons.find(
    (p) =>
      p.line?.key === "delacroix" && p.tags.has("founder") && p.sex === "M",
  );
  if (founder !== undefined) {
    founder.facts.push({
      tag: "NOBL",
      value: "Seigneur de la Croix (claimed, unproven)",
    });
    founder.facts.push({ tag: "CAST", value: "Acadian" });
  }
}

// ---------------------------------------------------------------------------
// GEDCOM emission
// ---------------------------------------------------------------------------

const MAX_LINE_VALUE = 200;
const out = [];

function emit(level, tag, value = null, xref = null) {
  const head = xref !== null ? `${level} ${xref} ${tag}` : `${level} ${tag}`;
  if (value === null || value === "") {
    out.push(head);
    return;
  }
  const segments = String(value).split("\n");
  segments.forEach((segment, i) => {
    const lineTag = i === 0 ? head : `${level + 1} CONT`;
    let chunk = segment;
    let first = true;
    do {
      const piece = chunk.slice(0, MAX_LINE_VALUE);
      chunk = chunk.slice(MAX_LINE_VALUE);
      out.push(first ? `${lineTag} ${piece}` : `${level + 1} CONC ${piece}`);
      first = false;
    } while (chunk.length > 0);
  });
}

function emitDate(level, dt, opts) {
  if (dt === null || dt === undefined) {
    return;
  }
  if (dt.phrase !== undefined) {
    emit(level, "DATE", `(${dt.phrase})`);
    return;
  }
  if (dt.from !== undefined) {
    emit(level, "DATE", `FROM ${dt.from} TO ${dt.to}`);
    return;
  }
  emit(level, "DATE", renderDate(dt, opts));
}

function hebrewDate(dt) {
  // 5,000-era Hebrew year for a Gregorian date, approximately.
  return `@#DHEBREW@ ${rng.int(1, 29)} ${rng.pick(HEBREW_MONTHS)} ${dt.y + 3760}`;
}

function frenchDate(dt) {
  return `@#DFRENCH R@ ${rng.int(1, 30)} ${rng.pick(FRENCH_MONTHS)} ${Math.max(1, dt.y - 1791)}`;
}

function emitCitation(level, c) {
  emit(level, "SOUR", c.source.xref);
  if (c.page !== null) {
    emit(level + 1, "PAGE", c.page);
  }
  if (c.dataText !== null || c.dataDate !== null) {
    emit(level + 1, "DATA");
    if (c.dataDate !== null) {
      emit(level + 2, "DATE", fmtExact(c.dataDate));
    }
    if (c.dataText !== null) {
      emit(level + 2, "TEXT", c.dataText);
    }
  }
  emit(level + 1, "QUAY", String(c.quality));
  if (c.note !== null) {
    emit(level + 1, "NOTE", c.note);
  }
}

function emitNote(level, n) {
  if (n.shared !== undefined) {
    emit(level, "NOTE", n.shared.xref);
  } else {
    emit(level, "NOTE", n.text);
  }
}

function emitMediaLink(level, link) {
  emit(level, "OBJE", link.record.xref);
  if (link.primary) {
    emit(level + 1, "_PRIM", "Y");
  }
}

function eventCitationFor(p, ev) {
  if (ev.source !== undefined && ev.source !== null) {
    return citation(
      ev.source,
      `p. ${rng.int(1, 400)}, entry ${rng.int(1, 60)}`,
      { dataDate: ev.date?.y !== undefined ? ev.date : null },
    );
  }
  return null;
}

function emitEvent(level, ev, owner) {
  emit(level, ev.tag, ev.value ?? null);
  if (ev.type !== undefined) {
    emit(level + 1, "TYPE", ev.type);
  }
  if (ev.hebrew) {
    emit(level + 1, "DATE", hebrewDate(ev.date));
  } else if (ev.french) {
    emit(level + 1, "DATE", frenchDate(ev.date));
  } else {
    emitDate(level + 1, ev.date, {
      exact: ev.exactDate === true,
      calendar: ev.calendar,
      dual: ev.dual,
    });
  }
  if (ev.place) {
    emit(level + 1, "PLAC", ev.place);
  }
  if (ev.age !== undefined) {
    emit(level + 1, "AGE", ev.age);
  }
  if (ev.cause !== undefined) {
    emit(level + 1, "CAUS", ev.cause);
  }
  if (ev.famc !== undefined) {
    emit(level + 1, "FAMC", ev.famc.xref);
    emit(level + 2, "ADOP", "BOTH");
  }
  if (ev.note !== undefined && ev.note !== null) {
    emit(level + 1, "NOTE", ev.note);
  }
  const c = ev.citation ?? eventCitationFor(owner, ev);
  if (c !== null) {
    emitCitation(level + 1, c);
  }
  if (ev.media !== undefined && ev.media !== null) {
    emitMediaLink(level + 1, { record: ev.media, primary: false });
  }
}

function emitFact(level, fact) {
  emit(level, fact.tag, fact.value ?? null);
  if (fact.type !== undefined) {
    emit(level + 1, "TYPE", fact.type);
  }
  if (fact.visibility !== undefined) {
    emit(level + 1, "_ROOTWARD_VIS", fact.visibility);
  }
  emitDate(level + 1, fact.date ?? null, { exact: true });
  if (fact.place) {
    emit(level + 1, "PLAC", fact.place);
  }
}

function emitName(level, n) {
  const surname = n.surname ?? "";
  emit(
    level,
    "NAME",
    `${n.given ?? ""} /${surname}/${n.suffix ? ` ${n.suffix}` : ""}`.trim(),
  );
  if (n.type !== undefined) {
    emit(level + 1, "TYPE", n.type);
  }
  if (n.prefix) {
    emit(level + 1, "NPFX", n.prefix);
  }
  if (n.given) {
    emit(level + 1, "GIVN", n.given);
  }
  if (n.nick) {
    emit(level + 1, "NICK", n.nick);
  }
  if (surname !== "") {
    emit(level + 1, "SURN", surname);
  }
  if (n.suffix) {
    emit(level + 1, "NSFX", n.suffix);
  }
}

// Header.
emit(0, "HEAD");
emit(1, "SOUR", "Rootward demo generator");
emit(2, "VERS", "1.0");
emit(2, "NAME", "Rootward demo generator");
emit(1, "DEST", "Rootward");
emit(1, "DATE", GENERATED_ON);
emit(1, "SUBM", "@U1@");
emit(1, "FILE", GED_FILENAME);
emit(1, "COPR", "Fictional demo data for Rootward. Public domain.");
emit(1, "GEDC");
emit(2, "VERS", "5.5.1");
emit(2, "FORM", "LINEAGE-LINKED");
emit(1, "CHAR", "UTF-8");
emit(1, "LANG", "English");
emit(
  1,
  "NOTE",
  `Generated with seed ${SEED}; ${persons.length} persons, ${families.length} families.`,
);

// Individuals.
for (const p of persons) {
  emit(0, "INDI", null, p.xref);
  const primaryType = p.tags.has("anglicized")
    ? "immigrant"
    : p.names.some((n) => n.type === "married")
      ? "birth"
      : p.names.some((n) => n.type === "maiden")
        ? "married"
        : undefined;
  emitName(1, {
    given: p.given,
    surname: p.surname,
    prefix: p.prefix,
    suffix: p.suffix,
    nick: p.nick,
    type: primaryType,
  });
  for (const n of p.names) {
    emitName(1, n);
  }
  if (p.sex === "M" || p.sex === "F" || p.sex === "X") {
    emit(1, "SEX", p.sex);
  }

  // Birth.
  const birthOpts = {
    exact: p.death === null,
    calendar:
      p.line?.julianUntil !== undefined &&
      p.birth.y < p.line.julianUntil &&
      p.birthPlace?.region === "gr"
        ? "julian"
        : undefined,
    dual: p.tags.has("dual") && p.birth.y < 1752,
  };
  emit(1, "BIRT");
  emit(2, "DATE", renderDate(p.birth, birthOpts));
  if (p.birthPlace) {
    emit(2, "PLAC", p.birthPlace.name);
  }
  emitCitation(
    2,
    citation(
      vitalSourceFor(p, p.birth.y),
      `p. ${rng.int(1, 300)}, no. ${rng.int(1, 80)}`,
      {
        dataDate: p.birth,
        dataText:
          p.famc?.partner1 && rng.chance(0.3)
            ? `${p.given}, ${p.sex === "F" ? "daughter" : "son"} of ${p.famc.partner1.given}.`
            : null,
      },
    ),
  );
  if (p.tags.has("twin")) {
    emit(2, "NOTE", "A twin.");
  }

  // Life events in date order.
  const events = p.events
    .slice()
    .sort(
      (a, b) =>
        (a.date?.y ?? a.date?.from ?? 0) - (b.date?.y ?? b.date?.from ?? 0),
    );
  for (const ev of events) {
    emitEvent(1, ev, p);
  }

  // Death and disposal.
  if (p.death !== null) {
    const deathOpts = {
      calendar:
        p.line?.julianUntil !== undefined &&
        p.death.y < p.line.julianUntil &&
        p.deathPlace?.region === "gr"
          ? "julian"
          : undefined,
    };
    const deathPlace = p.homePlace?.name ?? p.birthPlace?.name ?? null;
    emit(1, "DEAT");
    emit(2, "DATE", renderDate(p.death, deathOpts));
    if (deathPlace) {
      emit(2, "PLAC", deathPlace);
    }
    emit(2, "AGE", `${ageAt(p.birth, p.death)}y`);
    if (p.cause !== null) {
      emit(2, "CAUS", p.cause);
    }
    emitCitation(
      2,
      citation(
        vitalSourceFor(p, p.death.y),
        `p. ${rng.int(1, 300)}, no. ${rng.int(1, 80)}`,
        { dataDate: p.death },
      ),
    );
    if (p.death.y >= 1900 && rng.chance(0.06)) {
      const certificate = newMedia("document", {
        title: `Death certificate of ${fullName(p)}, ${p.death.y}`,
        date: after(p.death, 1),
        lines: [
          "CERTIFICATE OF DEATH",
          "",
          fullName(p),
          `Died ${fmtExact(p.death)}`,
          deathPlace ?? "",
          `Cause: ${p.cause ?? "not stated"}`,
        ],
      });
      emitMediaLink(2, { record: certificate, primary: false });
    }
    const cremated = p.death.y >= 1960 && rng.chance(0.3);
    {
      emit(1, cremated ? "CREM" : "BURI");
      emitDate(2, addYears(p.death, 0, 0), { exact: true });
      if (deathPlace) {
        emit(
          2,
          "PLAC",
          cremated
            ? deathPlace
            : `${rng.pick(["Oak Grove Cemetery", "St. Mary's Cemetery", "Riverside Cemetery", "Mount Hope Cemetery", "Evergreen Cemetery"])}, ${deathPlace}`,
        );
      }
      const gravestone =
        !cremated && rng.chance(0.15)
          ? newMedia("photo", {
              title: `Headstone of ${fullName(p)}`,
              date: date(p.death.y + rng.int(1, 60)),
              mono: false,
            })
          : null;
      emitCitation(
        2,
        citation(
          SOURCE_BY_ROLE.cemetery,
          `memorial ${rng.int(1000000, 99999999)}`,
          { quality: 2 },
        ),
      );
      if (gravestone !== null) {
        emitMediaLink(2, { record: gravestone, primary: false });
      }
    }
  }

  // Facts.
  for (const fact of p.facts) {
    emitFact(1, fact);
  }

  // Family links.
  if (p.famc !== null) {
    emit(1, "FAMC", p.famc.xref);
    const link = p.famc.children.find((c) => c.person === p);
    if (
      link?.relation !== null &&
      link?.relation !== undefined &&
      link.relation.p1 === link.relation.p2
    ) {
      emit(2, "PEDI", link.relation.p1);
    }
  }
  for (const f of families) {
    if (f.children.some((c) => c.person === p) && f !== p.famc) {
      emit(1, "FAMC", f.xref);
      emit(2, "PEDI", "step");
    }
  }
  for (const f of p.fams) {
    emit(1, "FAMS", f.xref);
  }

  // Identifiers, notes, citations, media.
  emit(1, "REFN", p.refn);
  emit(2, "TYPE", "Rootward demo id");
  if (p.afn !== undefined) {
    emit(1, "AFN", p.afn);
  }
  emit(1, "_FSFTID", p.fsftid);
  if (p.visibility !== undefined) {
    emit(1, "_ROOTWARD_VIS", p.visibility);
  }
  for (const n of p.notes) {
    emitNote(1, n);
  }
  for (const c of p.citations) {
    emitCitation(1, c);
  }
  for (const m of p.media) {
    emitMediaLink(1, m);
  }
  emit(1, "CHAN");
  emit(2, "DATE", GENERATED_ON);
}

// Families.
for (const f of families) {
  emit(0, "FAM", null, f.xref);
  if (f.partner1 !== null) {
    emit(1, f.role1, f.partner1.xref);
  }
  if (f.partner2 !== null) {
    emit(1, f.role2, f.partner2.xref);
  }
  for (const c of f.children) {
    emit(1, "CHIL", c.person.xref);
    if (c.relation !== null) {
      emit(2, "_FREL", c.relation.p1);
      emit(2, "_MREL", c.relation.p2);
    }
  }
  const events = f.events
    .slice()
    .sort((a, b) => (a.date?.y ?? 0) - (b.date?.y ?? 0));
  for (const ev of events) {
    emitEvent(1, ev, f.partner1 ?? f.partner2);
  }
  for (const fact of f.facts ?? []) {
    emitFact(1, fact);
  }
  for (const n of f.notes) {
    emitNote(1, n);
  }
  if (f.tags?.has("founding")) {
    const line = f.partner1?.line ?? null;
    const source =
      line !== null ? PARISH_SOURCE_FOR_LINE[line.key] : SOURCE_BY_ROLE.bible;
    emitCitation(1, citation(source, "marriages page", { quality: 3 }));
  }
}

// Sources.
for (const s of sources) {
  emit(0, "SOUR", null, s.xref);
  emit(1, "TITL", s.title);
  if (s.author) {
    emit(1, "AUTH", s.author);
  }
  if (s.publication) {
    emit(1, "PUBL", s.publication);
  }
  if (s.text) {
    emit(1, "TEXT", s.text);
  }
  emit(1, "REPO", s.repo.xref);
}

// Repositories.
for (const r of repositories) {
  emit(0, "REPO", null, r.xref);
  emit(1, "NAME", r.name);
  if (r.address) {
    emit(1, "ADDR", r.address);
  }
  if (r.phone) {
    emit(1, "PHON", r.phone);
  }
  if (r.email) {
    emit(1, "EMAIL", r.email);
  }
  if (r.website) {
    emit(1, "WWW", r.website);
  }
}

// Media records.
for (const m of mediaRecords) {
  emit(0, "OBJE", null, m.xref);
  emit(1, "FILE", m.file);
  emit(2, "FORM", m.form);
  emit(2, "TITL", m.title);
  if (m.date !== null) {
    emitDate(1, m.date, { exact: true });
  }
  if (m.note !== null) {
    emit(1, "NOTE", m.note);
  }
  emit(1, "CHAN");
  emit(2, "DATE", GENERATED_ON);
}

// Shared notes.
for (const n of sharedNotes) {
  emit(0, "NOTE", n.text, n.xref);
}

// Submitter and trailer.
emit(0, "SUBM", null, "@U1@");
emit(1, "NAME", "Rootward demo generator");
emit(0, "TRLR");

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, GED_FILENAME), out.join("\n") + "\n", "utf8");
writeFileSync(
  resolve(OUT_DIR, MANIFEST_FILENAME),
  JSON.stringify(
    { seed: SEED, gedcom: GED_FILENAME, files: manifest },
    null,
    2,
  ) + "\n",
  "utf8",
);

const living = persons.filter((p) => p.death === null).length;
const restricted = persons.filter((p) => p.visibility !== undefined).length;
const tally = (tag) => families.filter((f) => f.tags?.has(tag)).length;
console.log(
  [
    `Wrote ${GED_FILENAME}: ${persons.length} persons (${living} living, ${restricted} restricted), ${families.length} families,`,
    `${sources.length} sources, ${repositories.length} repositories, ${mediaRecords.length} media, ${out.length} lines.`,
    `Generations: ${[...generations.keys()]
      .sort((a, b) => a - b)
      .map((g) => `${g}:${generations.get(g).length}`)
      .join(" ")}`,
    `Unions: divorced ${families.filter((f) => f.ended?.type === "DIV").length}, annulled ${tally("annulled")},`,
    `partnerships ${families.filter((f) => f.kind === "partnership").length}, same-sex ${tally("same-sex")},`,
    `single-parent ${tally("single-parent")}, cousin ${tally("cousin-marriage")}, third marriage ${tally("third-marriage")},`,
    `widowed-remarried ${widowRemarriedDone}, stray ${tally("stray")}.`,
  ].join("\n"),
);
