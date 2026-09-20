import { readSpouseLinkKey } from "@/lib/tree/ended-unions";

/**
 * Tag the spouse links of ended unions (issue #122) so `family-tree.css` can
 * draw them dashed. Runs in the chart's `afterUpdate`, which fires right after
 * the library's `updateLinks` has entered every `path.link` for this layout —
 * the path elements exist at that point even though their `d` is still
 * animating. The class is toggled, not added, so a link that stops being an
 * ended union (an event deleted, then a re-centre) loses it again.
 *
 * d3 binds each path's datum to the element as `__data__` — that property is
 * what `selection.datum()` reads — so the link's two ends are read straight
 * off the DOM node rather than re-deriving the layout.
 */
export const ENDED_LINK_CLASS = "rw-link--ended";

export function markEndedUnionLinks(
  container: HTMLElement,
  endedKeys: ReadonlySet<string>,
): void {
  const links = container.querySelectorAll<SVGPathElement>(
    "svg .links_view path.link",
  );
  for (const path of links) {
    const datum = (path as SVGPathElement & { __data__?: unknown }).__data__;
    const key = readSpouseLinkKey(datum);
    path.classList.toggle(ENDED_LINK_CLASS, key !== null && endedKeys.has(key));
  }
}
