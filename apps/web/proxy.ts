import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 proxy (the former `middleware.ts`). Runs on the Node runtime, on
 * every request the matcher allows, to refresh the Supabase session and gate
 * access (SPEC §8.1). The real logic is in `lib/supabase/proxy.ts` so it can be
 * reasoned about apart from the file-convention wiring.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except:
     *  - _next/static, _next/image  (build output)
     *  - favicon.ico, robots.txt, sitemap.xml
     *  - anything with a file extension (images, fonts, …)
     * Auth routes are matched — the proxy lets them through itself.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.[\\w]+$).*)",
  ],
};
