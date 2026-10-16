# Customer-feedback patch — review and device QA

This branch addresses two customer emails supplied as four screenshots (one screenshot is duplicated). Customer names, messages and screenshots are not included in the repository.

## Feedback → changes

| Feedback | Implementation |
| --- | --- |
| Kept photos reappear after reopening | Persist lightweight asset IDs; wait for storage hydration before starting a session; Undo removes the corresponding keep decision. |
| Random Mix starts with only recent photos | Scan metadata page boundaries across the entire permitted library, shuffle page order and then items within each page. Reviewed-only pages are skipped. |
| Want whole months/years for photos and videos | Explicit Whole year / Whole month / Day controls, plus All media / Photos / Videos; year choices extend to the oldest accessible item. |
| Black screen/spinner and return to lock screen after hundreds of swipes | Reduce long-session work: bounded rendered history, serialized pagination, disk-only image prefetch, top-card-only video sources, no per-swipe native file-size scan, batched storage writes. These mitigate plausible pressure sources; they do **not** establish the cause or prove the reported system restart is fixed. |

Additional safety fixes: persist an empty bin after restore, make bin additions synchronous with Undo, retain expired entries if native deletion is cancelled/fails, and don't celebrate a failed single-item deletion. Display sizes as estimates instead of claiming physical storage recovery.

## Deliberate limitations

- **Not an App Store release.** Main is unchanged. No native iOS build, simulator or physical-device test has been run in this Linux workspace.
- Existing keeps from an older installation cannot be recovered: the old app persisted totals, not the asset IDs. Decisions are remembered prospectively.
- Random Mix is page-stratified, not an independent uniform full-library shuffle. All page boundaries participate, so older years are eligible, but consecutive cards can cluster by date.
- Random preparation scans metadata on each new Random session. It retains cursors rather than a full-library photo array; progress and Cancel are shown. Measure startup time on large libraries before release.
- Native asset cursors can shift if the photo library changes mid-session. A new session rebuilds them; test permission/library changes on-device.
- Saves are serialized and throttled at 250 ms, with background/end/unmount flush. An abrupt termination or storage failure may still lose the most recent unsaved decisions.
- File-size fallbacks remain estimates (3 MiB/photo, 15 MiB/video), not measurements of reclaimed device capacity. iOS Recently Deleted/iCloud behavior still applies.
- The existing seven-day bin expiry policy is preserved; unsuccessful automatic deletion is attempted once per provider mount, with manual deletion still available.
- Only assets permitted by iOS photo access can be included. No bypass of Limited Photos access.

## Automated verification in this workspace

- Dependencies installed from the lockfile with `npm ci --ignore-scripts --no-audit --no-fund`. Repository lifecycle scripts were not executed.
- Original Jest baseline failed before executing tests because the Worklets native module was not mocked.
- Fixed the test-only Worklets mock; added pure-helper and PhotoProvider integration coverage.
- Full TypeScript baseline: **60 existing diagnostics**. This branch: **58 diagnostics**, with no new file/message diagnostics after normalizing line numbers. The two resolved diagnostics were UndoEntry literal widening. Full typecheck still fails: existing IAP SDK mismatches, missing screen styles, duplicate styles and other unrelated errors remain. This is not a clean-build claim.
- `git diff --check` is part of final verification.

## Required TestFlight/device checks before merging/releasing

Use disposable photos for deletion tests, and a development/TestFlight build, not only Expo Go.

1. **Kept decisions:** keep items → background → fully close → reopen; the items must not reappear. Undo a keep and confirm it becomes eligible again. Restore the final bin item and restart; bin must remain empty.
2. **Long sessions:** review at least 1,000 mixed photos/videos, crossing multiple page boundaries, on the reported device/OS if available and an older supported iPhone. Inspect peak/steady memory and CPU in Xcode Instruments; include iCloud-only media, rapid swipes, Undo, tab changes and preview open/close.
3. **Random library coverage:** use a library spanning 10+ years; repeat sessions and verify old years are eligible, pagination progresses, reviewed-only pages don't produce a false "clean" state, and Cancel/Retry work during preparation. Measure preparation latency for a very large library.
4. **Periods/media:** test entire year, entire month, individual day, February 2024, December/January, empty periods and daylight-saving boundaries. Test all three media filters; paginate beyond 200 matches without changing the selected period.
5. **Permissions/library changes:** Full Photos and Limited Photos access, permission denial/revocation, library additions/deletions while a session is active. Verify no unauthorized asset access and that restarting the session recovers cleanly.
6. **Deletion:** cancel the iOS confirmation, test a native rejection, then perform a successful deletion. No entry should vanish or success screen appear on failure. Confirm restore and expiry behavior with disposable assets.
7. **Entitlements:** test a real Pro purchase/restore in the sandbox/TestFlight, cold launch as Pro, and free-user limits/ads. Purchases and SDK type errors outside this patch need their own verification.
8. **Crash evidence:** collect timestamped device diagnostics/Organizer logs and Analytics Data (including relevant JetsamEvent, app crash, or system restart logs if present). A return to lock screen is not enough to distinguish app OOM, SpringBoard restart, watchdog or another system fault. Share redacted reports privately.

Do not tell reviewers the crash is resolved until a patched native build reproduces and passes the long-session scenario and the diagnostic evidence has been checked.