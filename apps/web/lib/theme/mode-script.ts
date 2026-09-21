/**
 * Inline pre-paint script that owns the `.dark` class (#75, #80). It runs
 * in `<head>` before first paint — an inline `<script>` there blocks
 * rendering until it has run, which is what makes it flash-free — and adds
 * `.dark` from the `data-mode` attribute the layout sets on `<html>`:
 * always for `dark`, from `prefers-color-scheme` for `system` (the server
 * cannot know the device setting), never for `light`. `lib/theme/apply.ts`
 * (`isDarkFor`) is the same rule for a client-side change.
 *
 * The server never puts `dark` in `<html className>`. A save in the picker
 * writes cookies, which makes Next re-render the route, layout included;
 * if the server's `className` carried `dark` only for the pinned mode, that
 * re-render would diff `"… dark"` → `"…"` after a Dark → System pick and
 * strip the class on a dark-scheme device, and this script does not run
 * again. With the class owned here and by `apply.ts`, React's `className`
 * prop is constant and it never touches the DOM class. The script itself
 * always ships with this constant body, so the element never flips either.
 * Pattern: https://ui.shadcn.com/docs/dark-mode/next
 */
export const SYSTEM_MODE_SCRIPT =
  '(function(){var h=document.documentElement,m=h.getAttribute("data-mode");if(m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)){h.classList.add("dark")}})();';
