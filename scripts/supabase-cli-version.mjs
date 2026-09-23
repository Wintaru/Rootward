// The Supabase CLI version that generates `apps/web/lib/db/database.types.ts`.
//
// This is the source. Anything that can import it does, and anything that
// cannot is checked against it by `pnpm check:cli-version` (issue #103).
//
// Why it is pinned at all: different CLI versions emit slightly different
// generic-type boilerplate for the same schema. An unpinned call regenerates a
// different file on every machine, so CI's type-drift check fails for reasons
// that have nothing to do with the schema. It has drifted twice — commit
// `dea7b43` fixed the first, and a second followed because that fix missed
// `scripts/dev-fresh.mjs`.
//
// To bump: change it here, run `pnpm gen:types`, commit the regenerated types,
// and update the two literals `pnpm check:cli-version` names. It will tell you
// exactly which ones if you forget.
export const SUPABASE_CLI_VERSION = "2.116.0";
