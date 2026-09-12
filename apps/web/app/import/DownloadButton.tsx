"use client";

import { useMemo, useState } from "react";

import { type ExportJob, signExportDownload } from "@/lib/db";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DownloadState =
  | { readonly status: "idle" }
  | { readonly status: "signing" }
  | { readonly status: "error"; readonly message: string };

const BUTTON_CLASS = {
  /** The call to action on a just-finished export. */
  primary:
    "bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50",
  /** One row of the past-jobs list. */
  compact:
    "border-border rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50",
} as const;

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
  variant?: keyof typeof BUTTON_CLASS;
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
      <button
        type="button"
        onClick={() => void download()}
        disabled={state.status === "signing"}
        className={BUTTON_CLASS[variant]}
      >
        {state.status === "signing" ? "Preparing…" : "Download"}
      </button>
    </span>
  );
}
