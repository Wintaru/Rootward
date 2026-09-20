"use client";

import { useMemo, useState } from "react";

import { type ExportJob, signExportDownload } from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type DownloadState =
  | { readonly status: "idle" }
  | { readonly status: "signing" }
  | { readonly status: "error"; readonly message: string };

/**
 * Mints a fresh signed URL on click, then hands it to the browser. The URL
 * carries `Content-Disposition: attachment`, so `location.assign` saves the
 * file without leaving the page. Minting on demand means a link never goes
 * stale and no URL is signed for a row nobody downloads — the same path for
 * the just-finished card and every list row.
 */
export function DownloadButton({
  job,
  variant = "compact",
}: {
  job: ExportJob;
  /** `primary` — the call to action on a just-finished export; `compact` —
   * one row of the past-jobs list. */
  variant?: "primary" | "compact";
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<DownloadState>({ status: "idle" });

  const download = async (): Promise<void> => {
    setState({ status: "signing" });
    try {
      const url = await signExportDownload(supabase, job);
      window.location.assign(url);
      setState({ status: "idle" });
    } catch (error: unknown) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <span className="flex items-center gap-2">
      {state.status === "error" && (
        <span className="text-destructive text-xs" role="alert">
          {state.message}
        </span>
      )}
      <Button
        type="button"
        onClick={() => void download()}
        disabled={state.status === "signing"}
        // `primary` is the call to action on a just-finished export;
        // `compact` is one row of the past-jobs list.
        variant={variant === "primary" ? "default" : "outline"}
        size={variant === "primary" ? "default" : "xs"}
      >
        {state.status === "signing" ? "Preparing…" : "Download"}
      </Button>
    </span>
  );
}
