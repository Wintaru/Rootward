/** A titled card, the layout every `/moderation` queue panel shares. */
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
    <section className="border-border flex flex-col gap-4 rounded-lg border p-6">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-medium">{title}</h2>
        {description !== undefined && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
