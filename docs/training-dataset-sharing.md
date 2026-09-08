# Training dataset sharing

`POST /api/training-datasets` accepts an `application/zip` Keating training archive with `X-Keating-Training-Consent: global-improvement-v1`. The user must explicitly agree to sharing the selected archive for global Keating improvement. Building or downloading an archive does not send it.

The endpoint requires the deployment-owned, server-validated Not Organic product-session adapter (`notOrganicSessionAdapter`) with feature `keating:training-datasets`. Browser account claims and the local Courses identity are not accepted. Missing auth infrastructure returns 503; an adapter with no signed-in account returns 401.

Set **server-only** `KEATING_TRAINING_DATASETS_STORAGE_DIR` to an absolute path on a mounted persistent volume, for example `/data/keating-training-datasets`. Provision and back up that volume before enabling sharing. There is no development or ephemeral-storage fallback. The endpoint returns 503 without this setting, or when writing/syncing fails. Filesystem durability follows the mounted volume's guarantees; an environment variable alone cannot prove the volume survives platform replacement.

An accepted upload is limited to 25 MiB compressed, 100 MiB expanded, 64 ZIP entries and 100,000 canonical records. ZIP paths, checksums, compression limits, manifest and canonical records are validated. ZIP64, encryption, symbolic links, unsafe paths and unexpected file extensions are rejected. Archives are stored privately, without extracting their content. Each UUID directory contains `dataset.zip` and `metadata.json`, with account owner, consent version/purpose/time, byte count, SHA-256 and record count. Files are synced before atomic directory rename; the parent directory is synced before issuing a 201 receipt.

No public read, list or download endpoint is provided. No model calls, automatic uploads, global training jobs, or deployment changes are performed by this feature. Operators must define retention/deletion and training access procedures separately before collecting production contributions. No dataset has been uploaded by implementing this route.
