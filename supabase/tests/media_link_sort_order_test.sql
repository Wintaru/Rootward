-- media_link.sort_order backfill (migration 20260920100000, issue #116) and
-- the invariant it leaves behind: no link is left without a position.
--
-- The backfill itself has already run by the time pgTAP connects, so this
-- re-runs the same statement against fresh fixtures inside the test
-- transaction and checks the numbering it produces.

begin;
select plan(5);

insert into public.person (id, given_name, surname) values
  ('67000000-0000-0000-0000-000000000001', 'Owner', 'One'),
  ('67000000-0000-0000-0000-000000000002', 'Owner', 'Two');

insert into public.media (id, original_filename, mime_type, size_bytes, storage_path_original) values
  ('68000000-0000-0000-0000-000000000001', 'a.jpg', 'image/jpeg', 1, 'a/original.jpg'),
  ('68000000-0000-0000-0000-000000000002', 'b.jpg', 'image/jpeg', 1, 'b/original.jpg'),
  ('68000000-0000-0000-0000-000000000003', 'c.jpg', 'image/jpeg', 1, 'c/original.jpg'),
  ('68000000-0000-0000-0000-000000000004', 'd.jpg', 'image/jpeg', 1, 'd/original.jpg');

-- Owner One: one link already numbered (0), then two null uploads, the later
-- of which is primary. Owner Two: one null link.
insert into public.media_link (id, media_id, owner_type, owner_id, is_primary, sort_order, created_at) values
  ('69000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
   'person', '67000000-0000-0000-0000-000000000001', false, 0,    '2026-01-01'),
  ('69000000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000002',
   'person', '67000000-0000-0000-0000-000000000001', false, null, '2026-01-02'),
  ('69000000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000003',
   'person', '67000000-0000-0000-0000-000000000001', true,  null, '2026-01-03'),
  ('69000000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000004',
   'person', '67000000-0000-0000-0000-000000000002', false, null, '2026-01-04');

-- The migration's statement, verbatim.
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

select is(
  (select sort_order from public.media_link where id = '69000000-0000-0000-0000-000000000001'),
  0::smallint,
  'an already-numbered link keeps its position');

select is(
  (select sort_order from public.media_link where id = '69000000-0000-0000-0000-000000000003'),
  1::smallint,
  'the primary null link is numbered first among the nulls, after the numbered one');

select is(
  (select sort_order from public.media_link where id = '69000000-0000-0000-0000-000000000002'),
  2::smallint,
  'the other null link follows by created_at');

select is(
  (select sort_order from public.media_link where id = '69000000-0000-0000-0000-000000000004'),
  0::smallint,
  'another owner is numbered from 0 on its own');

select is(
  (select count(*) from public.media_link where sort_order is null),
  0::bigint,
  'no media_link is left without a sort_order');

select * from finish();
rollback;
