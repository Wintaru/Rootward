/**
 * Arrow-key movement for a custom radiogroup (#80): the WAI-ARIA radio
 * pattern — Right/Down move to the next option, Left/Up to the previous,
 * both wrapping, and Home/End jump to the ends. Moving also selects, as a
 * native radio does. Pure: the component focuses and selects whatever index
 * comes back. https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 */
export function nextRadioIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  if (count === 0) {
    return null;
  }
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
