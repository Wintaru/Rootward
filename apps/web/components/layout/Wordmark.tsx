import Link from "next/link";

/**
 * "Rootward" in the display face, with the mark the theme's chassis asks for
 * (#79). Every mark is rendered; `chrome.css` shows one by the `data-mark`
 * attribute on `<html>` (`none`, `circle`, `sprig`, `subtitle`). The subtitle
 * is the tree's name, so it only exists when an admin has set one.
 */
export function Wordmark({
  treeName,
  href,
}: {
  readonly treeName: string | null;
  /** Wrap in a link to this route; omit for a static wordmark (login). */
  readonly href?: string;
}) {
  const body = (
    <>
      <span
        className="rw-wordmark__mark rw-wordmark__mark--circle"
        aria-hidden="true"
      >
        R
      </span>
      <SprigIcon className="rw-wordmark__mark rw-wordmark__mark--sprig" />
      <span>Rootward</span>
      {treeName !== null && (
        <span className="rw-wordmark__subtitle">{treeName}</span>
      )}
    </>
  );
  return href === undefined ? (
    <span className="rw-wordmark">{body}</span>
  ) : (
    <Link href={href} className="rw-wordmark">
      {body}
    </Link>
  );
}

/** A stroke sprig — stem with three leaves — in `currentColor`. */
function SprigIcon({ className }: { readonly className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21V8" />
      <path d="M12 13c-3.2 0-5.5-2.3-5.5-5.5C9.7 7.5 12 9.8 12 13Z" />
      <path d="M12 17c3.2 0 5.5-2.3 5.5-5.5-3.2 0-5.5 2.3-5.5 5.5Z" />
      <path d="M12 8c-2.3 0-4-1.7-4-4 2.3 0 4 1.7 4 4Z" />
    </svg>
  );
}
