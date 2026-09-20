"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { type HeaderNavLink, isActiveHref } from "@/lib/auth/header-nav";
import { cn } from "@/lib/utils";

/**
 * The role-gated header links (#50) with `aria-current="page"` on the one
 * for the current route (#79). The look — underline, pill, or caps — is the
 * theme's `data-nav` chassis switch, applied in `chrome.css`.
 */
export function HeaderNav({
  links,
  className,
  stacked = false,
}: {
  readonly links: readonly HeaderNavLink[];
  readonly className?: string;
  /** Vertical list, for the mobile menu. */
  readonly stacked?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className={cn("rw-nav", stacked && "rw-nav--stacked", className)}
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActiveHref(pathname, link.href) ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
