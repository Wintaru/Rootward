# The Rootward demo tree

A fictional family of about 600 people across ten generations (the
generator prints the exact counts), built to exercise
every field the site can show and every family shape it has to render. Use
it for demos and for testing at a realistic size.

| File                  | What it is                                                | In git |
| --------------------- | --------------------------------------------------------- | ------ |
| `rootward-demo.ged`   | The GEDCOM 5.5.1 text. Deterministic output of the generator. | yes    |
| `rootward-demo.gdz`   | The GedZip: the `.ged` plus one file per `OBJE` record.   | no     |
| `media/`              | The fetched photos and generated PDFs the `.gdz` bundles. | no     |
| `media-manifest.json` | Which file each `OBJE` needs, written by the generator.   | no     |

## Build it

```sh
pnpm demo:build
```

This runs two scripts in `scripts/demo-tree/`:

1. `generate.mjs` builds the tree from a fixed seed and writes the `.ged`
   and the manifest. No network. The same seed always gives the same file.
2. `build-gedzip.mjs` fetches one photo per manifest entry from
   [cataas.com](https://cataas.com) (with [picsum.photos](https://picsum.photos)
   as the fallback), writes the PDF "scans", and zips everything flat next to
   the `.ged` — the same layout as a MacFamilyTree export's media folder.
   Fetched files are cached in `media/`, so a second run is quick.

Then open `/import` in the app and choose `rootward-demo.gdz`. The importer
matches each `OBJE` `FILE` to an archive entry and stores the bytes.

## What is in it

- Seven founding lines from different countries, who arrive between 1780
  and 1912 and intermarry. Old-country given names before arrival, one
  anglicised surname with a `birth`-type name record.
- Every event type the importer maps, every fact type, every name type, and
  every date kind: exact, about, estimated, calculated, before, after,
  between, from–to, interpreted, and free-text phrases. Julian, Hebrew, and
  French Republican calendar dates, and a 1749/50 dual-year date.
- Family shapes: married, divorced and remarried, annulled, widowed and
  remarried, three marriages, unmarried partners, two same-sex couples with
  adopted children, single parents, twins, step / adopted / foster /
  guardian / sealed children, a first-cousin marriage (pedigree collapse),
  and an unlinked stray family that shares a surname.
- One person of `other` sex and one with no `SEX` line.
- A portrait for every person (monochrome for anyone born before 1930),
  wedding photos, headstone photos, and PDF marriage records and death
  certificates. Sources, repositories, citations with `PAGE` / `QUAY` /
  `DATA`, inline and shared notes, `REFN` / `AFN` / `_FSFTID` ids, and SSNs
  on some living people (a sensitive fact).

Nothing in a GEDCOM maps to `person.visibility`, so every imported person is
`everyone_approved`. Set visibility in the app after import if a demo needs
hidden people.

## Change it

Edit `scripts/demo-tree/generate.mjs` and run `pnpm demo:gen`. The tree's
size is set by the `--trace` rates (the share of people whose descendants
the tree follows, by era); the generator prints the counts it produced. The
Deno test `supabase/functions/gedcom-export/exporter.test.ts` checks that a
regenerated file still covers every shape listed above and still round-trips
through import and export, and — when the `.gdz` has been built — that every
media record has a real file in the archive.
