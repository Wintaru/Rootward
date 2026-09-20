"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { DownloadButton } from "@/app/import/DownloadButton";
import { Section } from "@/components/layout/Section";
import {
  createExportJob,
  type ExportJob,
  getExportJob,
  getPersonCount,
  invokeGedcomExport,
} from "@/lib/db";
import {
  NEVER_STARTED_MESSAGE,
  POLL_MS,
  settle,
  settlePoll,
  type PollingState,
} from "@/lib/export/orchestrator";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { wipeTreeAction } from "./actions";
import { Field } from "./TreeSettingsForm";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BackupOutcome =
  | { readonly ok: true; readonly job: ExportJob }
  | { readonly ok: false; readonly message: string };

/**
 * Run one `manual_gedcom` export to completion and hand back the finished
 * job, or why it did not finish. The same `createExportJob` /
 * `invokeGedcomExport` / `getExportJob` calls `useGedcomExport` makes, and
 * the same pure `settle` / `settlePoll` decisions that hook's reducer runs on
 * (`lib/export/orchestrator.ts`) — reused here rather than re-derived, so a
 * dropped `functions.invoke` call gets the same "poll the row, the function
 * may still be working" grace period instead of failing a possibly-fine
 * export outright. This is a plain awaited sequence rather than the hook's
 * reducer because `WipeTreeSection` has no incremental progress to render —
 * it only needs the final outcome.
 */
async function runBackupExport(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  startedBy: string,
): Promise<BackupOutcome> {
  const jobId = crypto.randomUUID();
  await createExportJob(supabase, { id: jobId, startedBy });
  const invoke = await invokeGedcomExport(supabase, jobId);

  let job = await getExportJob(supabase, jobId);
  let settlement = settle(job, invoke);

  if (settlement.kind === "wait") {
    let polling: PollingState = {
      status: "polling",
      jobId,
      polls: 0,
      dropped: invoke.ok ? NEVER_STARTED_MESSAGE : invoke.message,
    };
    while (settlement.kind === "wait") {
      await sleep(POLL_MS);
      job = await getExportJob(supabase, jobId);
      settlement = settlePoll(polling, job);
      polling = { ...polling, polls: polling.polls + 1 };
    }
  }

  return settlement.kind === "completed"
    ? { ok: true, job }
    : { ok: false, message: settlement.message };
}

/** Typed literally, not the tree name — `tree_settings.tree_name` may be
 * unset, and this is the single most destructive action in the app (every
 * person, not one), so a fixed phrase reads clearer than an optional name. */
const CONFIRM_PHRASE = "WIPE";

type Stage =
  | { readonly status: "idle" }
  | { readonly status: "backing-up" }
  | { readonly status: "wiping"; readonly backupJob: ExportJob | null }
  | { readonly status: "done"; readonly backupJob: ExportJob | null }
  | { readonly status: "error"; readonly message: string };

/**
 * Admin-only "Wipe tree" (SPEC §7, §8.1, decisions 18/33, issue #60): removes
 * every person, family, event, fact, place, source, repository, media, and
 * note so the tree can be re-imported from scratch. The typed confirmation
 * phrase is a safety catch against a misclick, same posture as
 * `DeletePersonSection`'s typed-name confirmation — `wipe_tree`'s own
 * `is_admin()` check (`20260913191500_wipe_tree.sql`) is the real boundary
 * regardless.
 *
 * The `personCount` prop only decides what the confirmation copy says;
 * `handleWipe` re-reads the count itself right before deciding whether a
 * backup is needed, since the prop is a page-load snapshot that could be
 * stale by the time of the click. On a non-empty tree, decision 33's
 * "automatic backup first" runs a `manual_gedcom` export
 * ({@link runBackupExport}) before the wipe, and only proceeds if it
 * completes; a failed or dropped backup halts here rather than wiping data
 * with nothing to restore it from. The finished card offers the same
 * `DownloadButton` the export flow uses: the file lives in the separate
 * `exports` bucket (SPEC §4.8), so it survives the wipe untouched.
 *
 * `skipBackup` opts out of that export — unchecked by default, so decision
 * 33's safety net stays the default path; a moderator who is about to
 * re-import right away (or already holds a backup) can skip the wait.
 */
export function WipeTreeSection({
  personCount,
  startedBy,
}: {
  readonly personCount: number;
  readonly startedBy: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const skipBackupId = useId();
  const [confirmText, setConfirmText] = useState("");
  const [skipBackup, setSkipBackup] = useState(false);
  const [stage, setStage] = useState<Stage>({ status: "idle" });

  const confirmed = confirmText === CONFIRM_PHRASE;
  const busy = stage.status === "backing-up" || stage.status === "wiping";

  async function runWipe(backupJob: ExportJob | null): Promise<void> {
    setStage({ status: "wiping", backupJob });
    const result = await wipeTreeAction();
    if (!result.ok) {
      setStage({ status: "error", message: result.error });
      return;
    }
    setStage({ status: "done", backupJob });
    router.refresh();
  }

  async function handleWipe(): Promise<void> {
    if (!confirmed || busy) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    try {
      // Re-checked here rather than trusted from the `personCount` prop
      // (a page-load snapshot): another moderator could complete an import
      // in the gap between render and this click, and skipping the backup
      // on a now-populated tree would defeat decision 33's safety net.
      if (skipBackup) {
        await runWipe(null);
        return;
      }

      const freshCount = await getPersonCount(supabase);
      if (freshCount === 0) {
        await runWipe(null);
        return;
      }

      setStage({ status: "backing-up" });
      const backup = await runBackupExport(supabase, startedBy);
      if (!backup.ok) {
        setStage({
          status: "error",
          message: `The backup export did not finish, so the tree was not wiped: ${backup.message}`,
        });
        return;
      }
      await runWipe(backup.job);
    } catch (err) {
      setStage({
        status: "error",
        message: `The backup export failed, so the tree was not wiped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  return (
    <Section
      title="Wipe tree"
      description="Removes every person, family, event, and record so the tree can be re-imported from scratch. Accounts, settings, and notifications are kept — a linked account is unlinked, not deleted."
    >
      {stage.status === "done" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm" role="status">
            The tree is wiped.
          </p>
          {stage.backupJob !== null && (
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-sm">
                A backup was made first:
              </span>
              <DownloadButton job={stage.backupJob} variant="primary" />
            </div>
          )}
        </div>
      ) : (
        <div className="border-destructive/50 flex flex-col gap-3 rounded-md border p-4">
          <p className="text-muted-foreground text-sm">
            {personCount === 0
              ? "This tree is already empty. No backup is needed."
              : skipBackup
                ? "No backup will be made — the tree wipes immediately."
                : `This tree has ${personCount.toLocaleString()} ${personCount === 1 ? "person" : "people"}. A backup GEDCOM export runs first, automatically — the wipe only proceeds once it succeeds.`}
          </p>
          {personCount > 0 && (
            <label
              htmlFor={skipBackupId}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <input
                id={skipBackupId}
                type="checkbox"
                checked={skipBackup}
                onChange={(e) => setSkipBackup(e.target.checked)}
                disabled={busy}
              />
              Skip the automatic backup (no export is kept — only do this if you
              already have one, or are about to re-import right away)
            </label>
          )}
          <Field
            label={`Type "${CONFIRM_PHRASE}" to confirm`}
            htmlFor={inputId}
          >
            <Input
              id={inputId}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </Field>
          {stage.status === "error" && (
            <p className="text-destructive text-sm" role="alert">
              {stage.message}
            </p>
          )}
          <Button
            className="w-fit"
            variant="destructive"
            type="button"
            onClick={() => void handleWipe()}
            disabled={!confirmed || busy}
          >
            {stage.status === "backing-up"
              ? "Backing up…"
              : stage.status === "wiping"
                ? "Wiping…"
                : "Wipe tree"}
          </Button>
        </div>
      )}
    </Section>
  );
}
