import {
  Alegreya,
  Alegreya_Sans,
  IBM_Plex_Sans,
  Newsreader,
  Nunito_Sans,
  Public_Sans,
  Young_Serif,
  Zilla_Slab,
} from "next/font/google";

/**
 * One `next/font/google` loader per family a theme uses (#75). Next
 * self-hosts the files at build time and emits an `@font-face` per family
 * behind the `.variable` class; attaching every class to `<html>` lets the
 * active theme's `--font-display` / `--font-body` resolve to a real face.
 * `preload` defaults to true, and a loader in the root layout then emits a
 * `<link rel="preload">` for its files on every route — so only the default
 * theme's two faces preload; the rest pass `preload: false` and the browser
 * fetches a face once a rule renders with it. Variable fonts need no weight
 * list; the static families name the weights the mocks use.
 * Docs: https://nextjs.org/docs/app/api-reference/components/font
 *
 * `variable` is `--font-<family in kebab case>` and must be a string literal
 * (Next's compiler reads the options statically). `registry.test.ts` reads
 * this file's literals and asserts every `var(--font-…)` a theme file uses
 * is one of them, so this file is the single source of the names.
 */

// Flexoki (default theme — preloaded)
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

// Rosé Pine
const youngSerif = Young_Serif({
  subsets: ["latin"],
  variable: "--font-young-serif",
  display: "swap",
  weight: ["400"],
  preload: false,
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  display: "swap",
  preload: false,
});

// Gruvbox
const zillaSlab = Zilla_Slab({
  subsets: ["latin"],
  variable: "--font-zilla-slab",
  display: "swap",
  weight: ["500", "600", "700"],
  preload: false,
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
  preload: false,
});

// Everforest
const alegreya = Alegreya({
  subsets: ["latin"],
  variable: "--font-alegreya",
  display: "swap",
  style: ["normal", "italic"],
  preload: false,
});

const alegreyaSans = Alegreya_Sans({
  subsets: ["latin"],
  variable: "--font-alegreya-sans",
  display: "swap",
  weight: ["400", "500", "700"],
  preload: false,
});

/** Every loader's `.variable` class, for `<html className>`. */
export const FONT_VARIABLE_CLASSES: readonly string[] = [
  newsreader.variable,
  ibmPlexSans.variable,
  youngSerif.variable,
  nunitoSans.variable,
  zillaSlab.variable,
  publicSans.variable,
  alegreya.variable,
  alegreyaSans.variable,
];
