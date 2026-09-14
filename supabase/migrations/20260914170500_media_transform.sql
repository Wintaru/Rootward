-- Non-destructive rotate/crop for a media item (SPEC §4.4, §8.3).
--
-- The transform lives on the `media` row; the original object is never
-- rewritten. The `thumb` / `display` derivatives are regenerated from the
-- original with this transform applied and written to fresh versioned
-- paths (`<media id>/thumb-<token>.webp`), so the existing
-- `storage_path_thumb` / `storage_path_display` columns keep pointing at the
-- current derivative and every reader is unchanged (see DECISIONS.md,
-- 2026-09-14 17:04).
--
-- `rotation` is clockwise degrees applied first. The crop rectangle is in
-- the *rotated* original's pixel space, all-or-nothing: a partially set rect
-- is not a state the pipeline can apply, so the CHECK rejects it.

alter table media
  add column rotation smallint not null default 0
    constraint media_rotation_check check (rotation in (0, 90, 180, 270)),
  add column crop_x integer,
  add column crop_y integer,
  add column crop_width integer,
  add column crop_height integer,
  add constraint media_crop_check check (
    (crop_x is null and crop_y is null
      and crop_width is null and crop_height is null)
    or (crop_x >= 0 and crop_y >= 0 and crop_width > 0 and crop_height > 0
      and crop_x is not null and crop_y is not null
      and crop_width is not null and crop_height is not null)
  );

comment on column media.rotation is
  'Clockwise degrees (0/90/180/270) applied to the original before the crop when the thumb/display derivatives are generated. The original object is never rotated.';
comment on column media.crop_x is
  'Crop rectangle (with crop_y/crop_width/crop_height) in the rotated original''s pixel space; all four null means no crop.';
