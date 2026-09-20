# Local Needle recall

Pi's `before_agent_start` hook supplies the current learner question and user-message branch to `loadLearnerContext`. With a configured local Needle runtime, the loader ranks saved evidence and recent exact learner-message spans, then includes bounded recall in the teaching context. Assistant and tool messages are excluded. Extracted facts remain `tentative-not-saved` by default. The optional calibrated admission path below can save selected quotes for future sessions; ordinary evidence-checked memory tools remain available.

Without configuration, on a model/hash mismatch, or on runtime failure, the ordinary durable learner context remains available. This integration does not require a Not Organic account. Course relevance review is a separate optional Jev operation.

## Native mobile

Settings → Local recall downloads the pinned 35 MB Needle model into private, backup-excluded storage. Downloading enables recall; removing the model disables it. The Library's **Search by meaning** action searches a bounded selection of recent saved notes on-device and retains text matches. Before tutor replies, recall selects at most four exact historical learner-message windows; assistant messages, attachment contents, the current question and later messages are excluded. The excerpt appendix is added after account pedagogy selection. It does not write learner-profile facts.

Embeddings stay local, but selected excerpts become part of the request to the chosen tutor, including a hosted tutor. Settings explains this before download. Account changes, data import/clear, source edits, cancellation and changed sessions invalidate pending recall. The in-memory index reuses vectors only for the exact model identity, source ID and source text; it prunes removed sources and is not exported.

`mobile/modules/keating-needle` binds the published C API directly for Android ARM64, iOS ARM64 and the ARM64 iOS simulator. Unsupported architectures and Expo Go have no Needle execution. `mobile/scripts/prepare-needle.mjs` verifies the SDK header and static libraries at revision `b274efcb211a9eef48c9a88da4b43bd569696a39`; Gradle and CocoaPods invoke preparation during their builds. The script does not download model weights. Generated SDK files are ignored by Git.

The native engine is process-global and has no cancellation or unload API. Work is serialized; JavaScript cancellation discards late results while native work retains its lease. Model removal waits for active inference to finish. Verified model backing bytes stay resident until the app exits. Do not describe cancellation as native interruption or removal as immediate memory unloading.

## Desktop host

Settings → Learning → Local recall installs a pinned 36 MB bundle through the desktop main process. JavaScript, WASM and weights are checked against fixed byte sizes and SHA-256 hashes before publication to the app workspace's `.keating/needle-managed/installed/` directory. This storage survives the changing localhost port used by packaged desktop launches. No Python installation or manual runtime configuration is needed.

The authorized native bridge exposes fixed `needle.status`, `needle.install`, `needle.cancelDownload`, `needle.remove` and `needle.embed` operations. The renderer supplies bounded text or empty control payloads, never download URLs or local executable paths. Status reports install state and byte progress. A dedicated Node worker loads independently verified bytes, serializes inference and terminates on removal, timeout or shutdown.

Settings → Learning → Local recall provides a default-off control in desktop. Each reply retrieves bounded exact learner excerpts from saved sessions and adds them only to the outgoing prompt. Account, tutor model, current question, source, setting and session changes invalidate pending work. Recall finishes before an accepted teaching adjustment is checked at the final provider boundary. Disabled recall uses the existing provider stream immediately. Standalone browsers use the WASM runtime described below.

The worker and manager are included by desktop staging. The download remains explicit. Existing workspace Python configurations are still supported as a fallback when managed assets are absent; managed assets take priority when installed.

The automated desktop check installed the real pinned assets in this machine's desktop workspace, produced finite 3,072-dimensional vectors, restarted the native service with external fetches blocked, and delivered an exact synthetic learner excerpt through the real reply-recall wrapper. The tutor transport was captured before any provider request. A separate Electron 33.4.11 check loaded and executed the worker from `app.asar`. GUI interaction testing remains with the user.

Reproduce against a built desktop runtime with:

```sh
rtk proxy node desktop/scripts/check-needle.mjs --workspace /path/to/desktop/workspace --install
```

Omit `--install` to require an existing model. Use `--runtime desktop/dist/app` to check the staged runtime. The command never removes the workspace or installed model.

## Standalone browser

Settings → Learning → Local recall downloads a pinned 36 MB bundle into browser
Cache Storage. The app verifies the JavaScript, WASM and model hashes before
saving and loading them. Inference runs in a dedicated worker with the published
Needle C ABI and sends no learner text to a network service. The reply adapter
uses the same exact learner spans, source checks and 4,000-character context
budget as desktop. Selected excerpts still accompany the chosen tutor request.

The model download is explicit and cancellable. Removing it disables recall,
terminates active worker inference and deletes the browser cache. Clearing site
data also removes it. WebAssembly, workers, Cache Storage and a secure context
are required. Build and development hooks prepare the pinned JS/WASM files;
model weights are downloaded only when the user chooses the Settings action.

Focused runtime tests cover verified persistence, cancellation, corrupted assets,
source/model drift and worker lifecycle. A code-run check executed the published
WASM engine and returned repeatable, finite 3,072-dimensional vectors. This was
an automated engine check; browser/manual testing remains with the user.

## Pinned Linux x86-64 setup

Use Python 3.11 or newer, Bun, and `uv`. Run from the Keating checkout. Setup downloads public packages/assets; inference uses explicit local paths, disables upstream downloads, and sets `NEEDLE_TELEMETRY=0`, `DO_NOT_TRACK=1`, `HF_HUB_DISABLE_TELEMETRY=1`, and `HF_HUB_OFFLINE=1` on every worker.

```bash
rtk proxy uv venv --python python3 .keating/tmp/needle/venv
rtk proxy uv pip install --python .keating/tmp/needle/venv/bin/python cactus-needle==3.0.1 huggingface-hub==1.32.0
rtk proxy env NEEDLE_TELEMETRY=0 DO_NOT_TRACK=1 HF_HUB_DISABLE_TELEMETRY=1 .keating/tmp/needle/venv/bin/python - <<'PY'
import hashlib, json, os, pathlib, platform, zipfile
from huggingface_hub import hf_hub_download

assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
os.umask(0o077)
root = pathlib.Path.cwd()
assets = root / '.keating/tmp/needle/assets'
assets.mkdir(parents=True, exist_ok=True)
repo = 'Cactus-Compute/needle3'
revision = 'b274efcb211a9eef48c9a88da4b43bd569696a39'
wheel = hf_hub_download(repo, 'python/cactus_needle-3.0.1-py3-none-manylinux2014_x86_64.whl', revision=revision)
with zipfile.ZipFile(wheel) as archive:
    (assets / 'libneedle.so').write_bytes(archive.read('needle/libneedle3.so'))
weights = hf_hub_download(repo, 'needle3.cact', revision=revision)
(assets / 'needle3.cact').write_bytes(pathlib.Path(weights).read_bytes())
expected = {
    'engine': ('libneedle.so', '978fce130aac08af506b5fe8bb2950da58e9479d0de69d972d9bd69db953568d'),
    'weights': ('needle3.cact', 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38'),
}
config = {'python': str(root / '.keating/tmp/needle/venv/bin/python'),
          'packageVersion': '3.0.1', 'sourceRevision': revision}
for key, (filename, digest) in expected.items():
    path = assets / filename
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, key + ' asset mismatch'
    config[key] = str(path)
    config[key + 'Sha256'] = digest
target = root / '.keating/pi-config/needle-runtime.json'
target.parent.mkdir(parents=True, exist_ok=True)
# Do not overwrite another configured runtime.
with target.open('x') as handle:
    json.dump(config, handle, indent=2)
target.chmod(0o600)
print('Configured local Needle assets and runtime.')
PY
```

These asset hashes are for the listed Linux engine and model revision. Other platforms need their own supported engine and verified hash; this is not a cross-platform installer. The package installation pins direct versions; transitive dependency resolution still follows the package registry. See the [Needle source](https://github.com/cactus-compute/needle) and [pinned asset repository](https://huggingface.co/Cactus-Compute/needle3/tree/b274efcb211a9eef48c9a88da4b43bd569696a39).

Keep the environment/assets in place while configured. To disable recall, move `.keating/pi-config/needle-runtime.json` aside. Learner-scoped `.keating/.../state/needle-index.json` contains private embeddings and selected evidence, is written atomically with mode `0600`, and can be rebuilt. Do not publish it. Cache entries are reused only for the exact model/engine identity, source ID, and source-text hash; removed or changed evidence is excluded on the next retrieval.

## Checks and limits

```bash
rtk proxy bun test ./test/needle-runtime.test.ts ./test/needle-memory.test.ts ./test/learner-context.test.ts ./test/learner-memory.test.ts
rtk proxy bunx tsc --noEmit
```

The CLI tests use deterministic model doubles and a real subprocess protocol fixture; Pi regression tests require local Unix sockets. A local native smoke additionally verified 3,072-dimensional embeddings and exact learner-text extraction through `loadLearnerContext`, without injecting a runtime. That proves the installed Linux path, not mobile execution, ranking quality, calibrated confidence, or learning effectiveness.

Native integration checks additionally cover the portable index, mobile retrieval/download boundaries, desktop IPC and final provider dispatch. Expo autolinking resolves both native modules. Android NDK 27/API 26 compiled and linked the ARM64 JNI bridge against the pinned library and the unsupported x86_64 stub; the ARM64 CMake build and 16 KB load alignment also passed. A host C++ harness compiles the shared wrapper against the verified upstream header and exercises its boundary with a C API double. The 4.0.0 Android release subsequently completed Kotlin/Gradle compilation and universal APK packaging; persistent release signing and 16 KiB APK alignment were verified. The universal APK retains the ARM64-only Needle embedding guard. Swift/Xcode compilation and device inference remain unverified. Manual/browser/device checks are left to the user.

Recall considers up to 128 saved evidence items and 24 recent user-message windows, with each window retaining its exact source offsets. At most four newly indexed windows are extracted per call; this is intentionally a bounded shortlist, not exhaustive memory mining. Similarity scores are standardized within the current corpus and used only for ordering. They are not probabilities. Recall alone never writes a durable memory.

The bridge is embedded in the compiled CLI. It passes learner text through a temporary `0600` input file descriptor, never command-line arguments, and removes the file afterward. This also avoids Bun's piped-stdin behavior with the Python child. A bounded deadline kills the worker process group and falls back to existing context. The current implementation hashes assets and starts the runtime per retrieval; optimizing that lifecycle is deferred until functional integration is complete.

## Calibrated CLI memory admission

Set `KEATING_MEMORY_JUDGE=notorganic` to enable the separate background review.
It uses the existing Not Organic judgement capability and sends only candidate
quotes with their complete originating learner messages, bounded to four quotes
of 3–240 characters and messages of at most 4,000 characters. It never uses direct
TypeSafe environment overrides. Local recall and replies still work with this
review off or unavailable; the reply path does not await Jev.

Each candidate receives two stable questions: a Noul for whether the exact quote
will be useful in future teaching, and a Choice among the five memory categories
plus `not-memory`. Full message context lets the rubric distinguish endorsement,
negation, quotations and temporary requests. The model cannot paraphrase the
memory. Decisions retain raw answers and concrete backend identity as `proxy`.

Saving requires separately fitted positive gates for both exact questions. Use
the artifact workflow in [judgement calibration](judgement-calibration.md), then
set `KEATING_MEMORY_CALIBRATION_FILE` and
`KEATING_MEMORY_CALIBRATION_FILE_SHA256`. Pin `KEATING_JUDGEMENT_MODEL` and
`KEATING_JUDGEMENT_CALIBRATION_SHA256` to the measured backend identity. A missing
artifact leaves reviews recorded but unsaved; an invalid configured artifact
stops the review. No fitted production memory calibration ships with Keating.

Raw private receipts are written under the selected learner's
`state/memory-admission-reviews/`. The memory store separately retains the exact
message ID, span, quote hash, questions, answers, thresholds and model identity.
Its legacy `source: "observed"` value means tentative memory; the attached
judgement explicitly remains `source: "proxy"`, with confidence capped at 0.65.

Admission rechecks the exact learner source and unchanged saved-memory snapshot
before an atomic write. New turns, session changes, shutdown, profile/account
changes, changed configuration and deadlines invalidate pending reviews. A
provider that ignores cancellation keeps its request lease until it settles,
preventing repeated background calls from piling up.

The 128-fact cap protects explicit facts and facts with unknown or incomparable
rank. Only a strictly lower-ranked judged observation under the same backend,
full calibration identity and exact rubrics can be replaced. Raw worth
probability supplies that ranking; its capped displayed confidence does not.
Older rubric receipts remain readable but cannot authorize current admission.
Durable facts enter their own 4,000-character context budget as whole entries;
Needle's temporary recall retains its separate 4,000-character budget.
Without Needle relevance ordering, explicit facts come first. Raw worth sorts
only memories with identical backend, calibration and question identities within
their existing positions; unrelated scores and unranked memories keep their
baseline positions.

The same admission rules now reach web, desktop and mobile through a separate,
default-off memory setting. Web uses an account-scoped IndexedDB bank; mobile
uses an account-scoped private local bank. Source rereads, calibration identity,
revision checks and bounded requests guard admission. Previously accepted
entries can enter the next prompt; new judgement work waits until the tutor
finishes so local scoring cannot take its runtime lease during a reply.

The integration is verified with injected judges and private store checks.
Hosted calibrated admission, measured memory usefulness and manual/device
behavior remain unverified.
