# Local board ownership across tabs

Status: implemented and verified locally. PWA installation/offline app loading
is out of scope; guest editing still uses the existing IndexedDB database.

One tab can write each local board key. Other tabs opening that same key show a
read-only message; they can navigate/copy without competing autosave writes.
Tabs using different account boards can edit independently. Separate devices or
browser contexts use cloud collaboration normally.

Web Locks coordinate active tabs. IndexedDB version 3 adds a `board-leases`
store while preserving existing `boards`, `assets`, keys and image Blobs. Every
board write checks the current lease token and expiry in the same transaction
as the write. A suspended/stale tab therefore cannot overwrite the new writer,
even when its timers resume late or Web Locks are unavailable. Canonical recovery
records share their base board lease. Ownership expires after 20 seconds without
a heartbeat; an expired owner must reopen from current data before editing.

Close the other tab, then choose **Reopen here**. Guest takeover rereads IndexedDB
before enabling edits; account takeover also fetches fresh server permission.
Local tab ownership composes with owner/editor/viewer access, so acquiring a tab
lease never grants cloud editing rights. Board switches flush pending local saves
and acquire the target before reading or writing it. A denied account open writes
nothing to another tab's canonical draft.

If ownership is lost, pointer work/history replay stops. The interrupted committed
draft is preserved under a separate UUID recovery key, without overwriting the
new writer or canonical recovery. The UI offers explicit restore after reopening.
Account restore checks access again; it preserves the current state as a recovery
backup and requires normal conflict handling before a cloud write. Late cloud
responses cannot overwrite a draft after lease loss. Original image bytes and
completed cloud-asset mappings stay available.

Verification includes seven atomic IndexedDB/upgrade tests, composed role/store
guards, late-response draft protection and three actual browser/API/DB scenarios:
guest takeover with viewport restoration, same-account/different-board ownership
with fresh access checks, and stale-writer recovery/history cancellation. The
version-2→3 upgrade test preserves existing guest objects and image Blob bytes.
Vite module disposal releases development locks/timers before hot replacement.

Active account offline edits remain local drafts and need an explicit cloud retry.
The app does not promise an offline reload, a Service Worker or installation UI.
No local board or image is automatically deleted, and signing in uploads nothing.
