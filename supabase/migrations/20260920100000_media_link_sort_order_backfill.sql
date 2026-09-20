-- Backfill media_link.sort_order for links that were created without one.
-- Issue #116.
--
-- `media-process` inserted the `media_link` row with only media_id / owner,
-- so every upload before this fix left `sort_order` null. The edit view's
-- Media section compares each row's `sort_order` against its list position
-- and reads a null as a pending reorder, so those persons reported unsaved
-- changes on every load. `media-process` now writes the position on insert;
-- this numbers the rows already there.
--
-- Order matches what the section displays (`getPersonMedia`: is_primary
-- first, then sort_order with nulls last, then created_at), and the null
-- rows are numbered *after* any row the owner already had numbered, so no
-- photo visibly moves. Runs as the migration role, not through PostgREST, so
-- the `safeupdate` guard does not apply -- but the statement carries a real
-- WHERE regardless.

with numbered as (
  select ml.id,
         coalesce(
           (select max(m2.sort_order) + 1
              from public.media_link m2
             where m2.owner_type = ml.owner_type
               and m2.owner_id = ml.owner_id),
           0)
         + row_number() over (
             partition by ml.owner_type, ml.owner_id
             order by ml.is_primary desc, ml.created_at asc
           ) - 1 as n
    from public.media_link ml
   where ml.sort_order is null
)
update public.media_link
   set sort_order = numbered.n
  from numbered
 where public.media_link.id = numbered.id;
