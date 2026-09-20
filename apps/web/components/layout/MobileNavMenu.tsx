"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { HeaderNavLink } from "@/lib/auth/header-nav";
import { cn } from "@/lib/utils";

import { HeaderNav } from "./HeaderNav";

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
    <details ref={detailsRef} className="relative lg:hidden">
      <summary
        aria-label="Menu"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden",
        )}
      >
        Menu
      </summary>
      <div className="bg-card border-border shadow-card absolute top-full left-0 z-20 mt-2 rounded-[calc(var(--radius)+4px)] border p-3">
        <HeaderNav links={links} stacked />
      </div>
    </details>
  );
}
