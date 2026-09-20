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
 * The account chip (#79): initials and first name, opening a menu with
 * **My record** (when the member is linked to a person) and **Sign out**.
 * The sign-out form moved here from the header bar; it is still a real form
 * posting a server action, so the keyboard path (Enter clicks the submit
 * button) and the mouse path are the same submit. The item's `onSelect`
 * is cancelled: Radix would otherwise close the menu in the microtask
 * between the click listener and the form's activation, and only the exit
 * animation would keep the form mounted long enough to submit. The redirect
 * re-renders the layout without the chip. "Appearance" joins this menu
 * with the picker (#80).
 */
export function AccountChip({
  identity,
  myRecordHref,
  signOutAction,
}: {
  readonly identity: ChipIdentity;
  readonly myRecordHref: string | null;
  readonly signOutAction: () => Promise<void>;
}) {
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
        {myRecordHref !== null && (
          <>
            <DropdownMenuItem asChild>
              <Link href={myRecordHref} className="text-popover-foreground">
                My record
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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
