/**
 * Shown when a signed-in account is not an active admin. RLS rejects the
 * same account server-side (`tree_settings_update` / `account_update` are
 * both `is_admin()`) — this is only the friendly surface.
 */
export function SettingsForbidden() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-muted-foreground text-lg">
        Tree settings and role management need administrator access. Ask an
        administrator to raise your role, then reload this page.
      </p>
    </main>
  );
}
