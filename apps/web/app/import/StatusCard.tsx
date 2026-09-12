import type { ReactNode } from "react";

/** The card shape both the import and the export flow render their stages in.
 * Titles are `h3`: each flow sits under its own `h2` on the page. */
export function StatusCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border flex flex-col gap-4 rounded-lg border p-6">
      <h3 className="text-lg font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function DeterminateBar({
  ratio,
  label,
}: {
  ratio: number;
  label: string;
}) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

export function IndeterminateBar({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="bg-muted h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label={label}
      >
        <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
      </div>
      <span className="text-muted-foreground text-xs">{label}…</span>
    </div>
  );
}
