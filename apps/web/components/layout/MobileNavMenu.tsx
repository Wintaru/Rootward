"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import type { HeaderNavLink } from "@/lib/auth/header-nav";

/**
 * The header's nav links behind a `<details>` disclosure below the `sm`
 * breakpoint (SPEC §8.1, #65) — the always-inline nav wraps onto its own line
 * at phone width and eats the space the tree/edit view needs. A client island
 * because `RootLayout` persists across a client-side navigation (it is the
 * only layout in the app), so an uncontrolled `<details>` would otherwise stay
 * open on the page a tapped link navigates to; closing it on `pathname`
 * change is the one bit of behaviour a server component can't provide.
 */
export function MobileNavMenu({
  links,
}: {
  readonly links: readonly HeaderNavLink[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (detailsRef.current !== null) {
      detailsRef.current.open = false;
    }
  }, [pathname]);

  return (
    <details ref={detailsRef} className="sm:hidden">
      <summary
        aria-label="Menu"
        className="border-border block w-fit cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium select-none"
      >
        Menu
      </summary>
      <nav aria-label="Main" className="mt-2 flex flex-col items-start gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
