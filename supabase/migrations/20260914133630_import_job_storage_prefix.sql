-- No schema change -- `import_job.storage_path` was always a bare `text`
-- column. Updates its comment to match the new client-side-unzip upload
-- shape (issue #104): the column now holds a Storage *prefix*
-- (`imports/<jobId>`), not a single object key. The GEDCOM text lands at
-- `<prefix>/gedcom.ged`; a GedZip's media, already unzipped in the browser
-- before upload, lands under `<prefix>/media/`, one object per archive file
-- (`@rootward/gedcom`'s `media-storage-keys` module owns that key shape,
-- shared by the web app's uploader and the `gedcom-import` edge function's
-- gateway). Never hand-edit the original migration that created this
-- column (20260830172736) -- this is a new migration for its own sake.

comment on column import_job.storage_path is
  'Storage prefix (imports/<job id>) the uploaded GEDCOM text and any GedZip media land under -- not a single object key. See @rootward/gedcom''s media-storage-keys module (issue #104).';
