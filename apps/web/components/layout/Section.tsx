/** A titled card, the layout every `/moderation` and `/settings` panel
 * shares — on the theme's card tokens with the display face for the title
 * (#79). */
export function Section({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="bg-card text-card-foreground border-border shadow-card flex flex-col gap-4 rounded-[calc(var(--radius)+4px)] border p-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-[22px] leading-tight font-semibold">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
