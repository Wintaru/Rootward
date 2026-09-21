/**
 * The friendly refusals on `/settings` (#80). RLS rejects the same account
 * server-side — `tree_settings_update` / `account_update` are both
 * `is_admin()`, and `set_appearance` needs a session — this is only the
 * surface.
 */

/** A signed-in account that is not active — `pending` or `suspended`:
 * nothing on `/settings` is theirs, the Appearance tab included. */
export function SettingsForbidden() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-muted-foreground text-lg">
        Settings need an active, approved account. Ask a moderator about your
        account, then reload this page.
      </p>
    </main>
  );
}

/** An approved member on an admin-only tab (Tree, Roles), reached by URL —
 * rendered inside the tab region so the tab bar stays. */
export function SettingsTabForbidden() {
  return (
    <p className="text-muted-foreground text-lg">
      Tree settings and role management need administrator access. Ask an
      administrator to raise your role, then reload this page.
    </p>
  );
}
