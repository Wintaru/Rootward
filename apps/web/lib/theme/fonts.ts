import { IBM_Plex_Sans, Newsreader } from "next/font/google";

/**
 * One `next/font/google` loader per family a theme uses (#75). Next
 * self-hosts the files at build time and emits an `@font-face` per family
 * behind the `.variable` class; attaching every class to `<html>` lets the
 * active theme's `--font-display` / `--font-body` resolve to a real face.
 * Note `preload` defaults to true: a loader in the root layout emits a
 * `<link rel="preload">` for its files on every route, so when #76 / #77
 * add the other families, pass `preload: false` on every face the default
 * theme does not use — the browser still fetches a face once a rule renders
 * with it. Both families here are variable fonts, so no weight list.
 * Docs: https://nextjs.org/docs/app/api-reference/components/font
 *
 * `variable` is `--font-<family in kebab case>` and must be a string literal
 * (Next's compiler reads the options statically). `registry.test.ts` reads
 * this file's literals and asserts every `var(--font-…)` a theme file uses
 * is one of them, so this file is the single source of the names.
 */

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

/** Every loader's `.variable` class, for `<html className>`. */
export const FONT_VARIABLE_CLASSES: readonly string[] = [
  newsreader.variable,
  ibmPlexSans.variable,
];
