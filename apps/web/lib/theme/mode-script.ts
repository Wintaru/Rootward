/**
 * Inline script for `system` mode (#75). The server cannot know the device
 * setting, so it renders no `.dark` class and this runs before first paint
 * to add it from `prefers-color-scheme` — an inline `<script>` in `<head>`
 * blocks rendering until it has run, which is what makes it flash-free.
 * `light` and `dark` modes are decided server-side and never ship it.
 * Pattern: https://ui.shadcn.com/docs/dark-mode/next
 */
export const SYSTEM_MODE_SCRIPT =
  '(function(){if(window.matchMedia("(prefers-color-scheme: dark)").matches){document.documentElement.classList.add("dark")}})();';
