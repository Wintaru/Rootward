# Backup, restore, and upgrade

A family tree is irreplaceable. This page gives three procedures. Each one
was run against a real stack before it was written. The record of that run
is at the end of the page.

Scheduled, automatic backups are a post-MVP feature (decision 29). Until
then you run these yourself, on a schedule you choose.

## What a complete backup holds

A Rootward deployment keeps data in two places. A backup must cover both.

| Part | Holds | Command |
| --- | --- | --- |
| The database | People, families, events, accounts, and the file list | `supabase db dump` |
| The `media` bucket | The photo and document bytes | `supabase storage cp` |

The `imports` and `exports` buckets hold working files. `imports` keeps the
staging copy of each GEDCOM import. `exports` keeps each export you asked
for. You can make both again from the database and the original files, so a
routine backup can leave them out. Save them only if you want the history.

> **The most important sentence on this page.** A database backup alone is
> not enough. The database holds the *list* of photos, not the photos. If
> you restore only the database, the tree looks complete and every photo is
> broken. See "The trap" below.

## 1. Backup

### The database

```sh
supabase db dump --local --data-only --use-copy \
  -x storage.buckets -x storage.buckets_vectors -x storage.vector_indexes \
  -f rootward-data-$(date +%F).sql
```

Use `--local` for a self-host deployment. Use `--linked` for Supabase Cloud,
after `supabase link`.

Four things about this command are not obvious.

- **It includes your accounts.** The dump covers the `auth` and `storage`
  schemas as well as `public`. Sign-in keeps working after a restore.
- **The three exclusions are necessary.** `storage.buckets` collides with
  the buckets the migrations already made. `storage.buckets_vectors` and
  `storage.vector_indexes` belong to the Supabase platform, and the
  `postgres` role cannot write them. All three are empty in Rootward. A
  dump without these flags stops part-way through the restore.
- **`--use-copy` makes the file much smaller.** Without it the dump uses one
  INSERT statement for each row.
- **It does not include the schema.** The migrations are the schema. A
  restore applies the migrations first. See section 2.

Compress the result. The dump is text and it compresses well:

```sh
gzip rootward-data-$(date +%F).sql
```

**`audit_log` is almost all of the size.** The table records each change to
the tree. In the test below it held 233,650 rows and made 95% of the dump.
To keep only the tree itself, add `-x public.audit_log`. You then lose the
change history, but no person, photo, or account.

### The media bucket

```sh
supabase storage cp -r --local --experimental \
  ss:///media ./rootward-media-$(date +%F)
```

`--experimental` is necessary. The `supabase storage` commands refuse to run
without it in CLI 2.117.0.

Count the files afterwards and compare the number with the database:

```sh
find ./rootward-media-$(date +%F) -type f | wc -l
psql "$DB_URL" -Atc \
  "select count(*) from storage.objects where bucket_id = 'media'"
```

The two numbers must agree.

### What to keep, and for how long

- Keep the newest backup off the machine that runs Rootward. A disk failure
  must not take the tree with it.
- Keep one backup for each week of the last month, and one for each month
  after that. A tree changes slowly, and a mistake can stay unnoticed for
  weeks.
- Make a backup before each upgrade. See section 3.
- Test a restore twice each year. A backup you never restored is a guess.

## 2. Restore

The order matters. The schema must exist before the data lands, and the
photo bytes must land before anyone opens the tree.

### Step 1 — an empty stack with the schema

Self-host:

```sh
supabase start
supabase db push --local
```

Cloud: make a new project, then `supabase link`, then `supabase db push`.

`db push` applies each migration and makes the 23 tables, the RLS policies,
and the three storage buckets. It does not load seed data.

### Step 2 — the database

```sh
gunzip -c rootward-data-2026-09-22.sql.gz | psql "$DB_URL" -v ON_ERROR_STOP=1
```

`ON_ERROR_STOP=1` is important. Without it `psql` reports an error and keeps
going, and you get a part-filled tree that looks finished.

The dump sets `session_replication_role = replica` at the top. That turns
off triggers for the session, which the restore needs: `person` and
`account` refer to each other, so no insert order satisfies both.

### Step 3 — the photo bytes

```sh
supabase storage cp -r --local --experimental \
  ./rootward-media-2026-09-22/. ss:///media
```

**Note the `/.` at the end of the source path.** Without it the CLI puts the
directory name inside the bucket, and each file lands at `media/media/...`
instead of `media/...`. The upload reports success. Every photo stays
broken, because the database points at the path without the extra prefix.

### Step 4 — check the restore

Compare each table with the source:

```sh
psql "$DB_URL" -Atc "select count(*) from public.person"
psql "$DB_URL" -Atc "select count(*) from public.media"
psql "$DB_URL" -Atc "select count(*) from storage.objects"
```

Then open the tree and look at a photo. A photo that loads proves step 3
worked. A photo that fails means the bytes are missing or at the wrong path.

### The trap

After step 2 and before step 3, the database is complete and each photo
request fails with HTTP 500. The `media` rows exist. The bytes do not. The
tree gives no warning, because nothing in the database knows the difference.
This was confirmed in the test below.

If you restore only the database, stop before you let the family in.

## 3. Upgrade

```sh
git pull
set -a; source .env; set +a
supabase db push --local
supabase stop
supabase start
docker compose up -d --build
```

Make a backup first. Section 1 takes a few seconds.

**`supabase stop` keeps your data.** It makes a backup of the database and
reports `"backup": true`. `supabase start` then reports
`Starting database from backup...` and the data returns. The storage files
stay in their Docker volumes through the restart. This was confirmed in the
test below: 628 people, 22,207 storage objects, and 2 accounts survived a
full stop and start, and a photo still loaded afterwards.

**`supabase stop --no-backup` destroys your data.** The flag removes each
data volume. Never use it on a deployment.

A change of Postgres version is the case this test did not cover. The CLI
may need to make the volume again, which would lose the data in it. Read the
CLI output before you answer any prompt, make a backup first, and expect to
restore with section 2 if the version moves.

Check `supabase/config.toml` against your own settings after each `git pull`.
A change from upstream can put a local-development default back.

## Test record

| Item | Value |
| --- | --- |
| Date | 2026-09-22 |
| Supabase CLI | 2.117.0 |
| Postgres | 17.6.1.166 |
| Tree | 628 people, 233 families, 863 media, 2 accounts |
| Database dump | 256 MB, 19 MB after gzip, about 4 seconds |
| Dump without `audit_log` | 14 MB, 2.5 MB after gzip, about 1 second |
| `media` bucket | 2,549 files, 51 MB |
| Restore of the database | about 3 seconds, 26 of 26 tables matched exactly |
| Restore of the bytes | 2,549 files, about 15 seconds |

The restore ran onto a separate, empty stack, not onto the source. Each of
the 26 tables in `public`, `auth.users`, `auth.identities`, and
`storage.objects` held the same number of rows as the source.

Three faults showed up during the test and the commands above avoid all
three: the bucket rows collide, two platform tables refuse the `postgres`
role, and the upload nests the directory when the source path has no `/.`.
