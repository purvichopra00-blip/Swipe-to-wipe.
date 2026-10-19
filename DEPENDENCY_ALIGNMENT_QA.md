# Expo SDK 54 dependency alignment — QA notes

## What changed
- Ran `expo install --fix` so every Expo-managed package matches the versions Expo SDK 54 expects (`expo install --check` now reports "Dependencies are up to date").
- `react-native-worklets` moved from `~0.7.0` (installed 0.7.4) to the SDK 54 pin `0.5.1`. Reanimated 4.1.x supports worklets 0.5–0.8, so no Reanimated change was needed.
- Removed `react-native-worklets-core` (Margelo). It was declared but never imported anywhere in the app; it only added a second native worklets runtime to the iOS/Android build.
- Removed the manual `react-native-worklets` Jest mock from `jest.setup.js`. Worklets 0.7.x hardcodes `IS_JEST = false` on native and therefore needed the mock; 0.5.1 detects Jest (`JEST_WORKER_ID`) and falls back to its JS implementation on its own. The `src/mock` file the old line relied on does not exist in 0.5.1.
- `patches/expo-firebase-core+6.0.0.patch` still applies cleanly after the dependency changes.

## Validation
- `expo install --check`: up to date (previously 12 outdated packages).
- `npm run check` (`tsc --noEmit` + `jest --runInBand`): 0 TypeScript errors, 49 tests passed across 5 suites.
- `expo export --platform ios`: Hermes bundle produced successfully. This is a JS-only sanity check, **not** a native build.

## Not covered here
- No native iOS/Android build was run (no Xcode/EAS in this environment). Run `npx expo prebuild --clean` or an EAS build before TestFlight to confirm the native worklets/reanimated versions link correctly.
- `npm audit` still reports pre-existing vulnerabilities (88 at the time of this change); nothing here addresses them.
- `expo-firebase-recaptcha` / `expo-firebase-core` remain in dependencies even though the only usage is a commented-out import in `app/(auth)/login.tsx`. Left untouched to keep this PR scoped to compatibility.
- Device testing for the customer-reported long-session crash, remembered keeps, and month/year filters is still outstanding.