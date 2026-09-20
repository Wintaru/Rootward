/**
 * The origin the visitor actually used, read from the request headers.
 *
 * `new URL(request.url).origin` is the origin the Next server *bound*
 * (`localhost` under `next dev`), not the one in the address bar. A visitor at
 * `127.0.0.1:3000` who is redirected to `localhost:3000` leaves their session
 * cookie behind (cookies are per host), so any redirect back into the app must
 * be built from `Host` — or `X-Forwarded-Host` / `X-Forwarded-Proto` when a
 * reverse proxy sits in front. Pure over a header lookup so it unit-tests
 * without a request.
 */
export interface HeaderLookup {
  get(name: string): string | null;
}

export interface ResolveRequestOriginOptions {
  /** Used when neither `X-Forwarded-Proto` nor the request says otherwise. */
  readonly defaultProtocol?: "http" | "https";
}

const KNOWN_PROTOCOLS = new Set(["http", "https"]);

/**
 * `<proto>://<host>` for the request, or `null` when no usable host header
 * arrived (an HTTP/1.0 client, or a value that is not a host at all — nothing
 * the app can redirect to).
 */
export function resolveRequestOrigin(
  headers: HeaderLookup,
  options: ResolveRequestOriginOptions = {},
): string | null {
  const host =
    firstListed(headers.get("x-forwarded-host")) ??
    firstListed(headers.get("host"));
  if (host === null) {
    return null;
  }
  const forwardedProto = firstListed(headers.get("x-forwarded-proto"));
  const proto =
    forwardedProto !== null && KNOWN_PROTOCOLS.has(forwardedProto)
      ? forwardedProto
      : (options.defaultProtocol ?? "http");
  // Round-trip through `URL` so a header that is not a host (spaces,
  // `user@host`, a path) yields `null` rather than a `Location` the redirect
  // helper throws on. `.origin` is the normalised `<proto>://<host>[:port]`.
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * A proxy chain appends to `X-Forwarded-*` as a comma-separated list; the
 * first entry is the one the client sent.
 */
function firstListed(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const first = value.split(",")[0]?.trim() ?? "";
  return first === "" ? null : first;
}
