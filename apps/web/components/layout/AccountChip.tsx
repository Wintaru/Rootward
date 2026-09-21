"use client";

import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChipIdentity } from "@/lib/auth/account-chip";

/**
 * The account chip (#79, #80): initials and first name, opening a menu with
 * **My record** (when the member is linked to a person), **Appearance**
 * (`/settings`, for an approved member), and **Sign out**.
 * The sign-out form moved here from the header bar; it is still a real form
 * posting a server action, so the keyboard path (Enter clicks the submit
 * button) and the mouse path are the same submit. The item's `onSelect`
 * is cancelled: Radix would otherwise close the menu in the microtask
 * between the click listener and the form's activation, and only the exit
 * animation would keep the form mounted long enough to submit. The redirect
 * re-renders the layout without the chip.
 */
export function AccountChip({
  identity,
  appearanceHref,
  myRecordHref,
  signOutAction,
}: {
  readonly identity: ChipIdentity;
  readonly appearanceHref: string | null;
  readonly myRecordHref: string | null;
  readonly signOutAction: () => Promise<void>;
}) {
  const links = [
    ...(myRecordHref === null
      ? []
      : [{ href: myRecordHref, label: "My record" }]),
    ...(appearanceHref === null
      ? []
      : [{ href: appearanceHref, label: "Appearance" }]),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rw-chip"
          aria-label={`Account menu for ${identity.firstName}`}
        >
          <span className="rw-chip__initials" aria-hidden="true">
            {identity.initials}
          </span>
          <span className="rw-chip__name">{identity.firstName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <Link href={link.href} className="text-popover-foreground">
              {link.label}
            </Link>
          </DropdownMenuItem>
        ))}
        {links.length > 0 && <DropdownMenuSeparator />}
        <form action={signOutAction}>
          <DropdownMenuItem
            asChild
            onSelect={(event) => event.preventDefault()}
          >
            <button type="submit" className="w-full">
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
