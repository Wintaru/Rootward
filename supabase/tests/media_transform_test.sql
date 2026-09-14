-- media.rotation / media.crop_* CHECK constraints (migration
-- 20260914170500): the derivative pipeline can only apply a whole rectangle
-- and a quarter-turn rotation, so the schema rejects anything else.

begin;
select plan(6);

insert into public.media (id, original_filename, mime_type)
values ('c0000000-0000-0000-0000-000000000001', 'a.jpg', 'image/jpeg');

select is(
  (select rotation from public.media
    where id = 'c0000000-0000-0000-0000-000000000001'),
  0::smallint,
  'rotation defaults to 0'
);

select lives_ok(
  $$ update public.media set rotation = 270
       where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'a quarter-turn rotation is accepted'
);

select throws_ok(
  $$ update public.media set rotation = 45
       where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a non-quarter-turn rotation is rejected'
);

select lives_ok(
  $$ update public.media
       set crop_x = 10, crop_y = 0, crop_width = 100, crop_height = 50
       where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'a whole crop rectangle is accepted'
);

select throws_ok(
  $$ update public.media
       set crop_x = 10, crop_y = null, crop_width = 100, crop_height = 50
       where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a partial crop rectangle is rejected'
);

select throws_ok(
  $$ update public.media
       set crop_x = 0, crop_y = 0, crop_width = 0, crop_height = 50
       where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  null,
  'a zero-width crop is rejected'
);

select * from finish();
rollback;
