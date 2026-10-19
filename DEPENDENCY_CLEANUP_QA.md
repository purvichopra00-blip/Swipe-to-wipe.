# Dependency cleanup — unused recaptcha + npm audit

## What changed
- Removed `expo-firebase-recaptcha`. Its only reference was a commented-out import and a comment in `app/(auth)/login.tsx`; the package was not used at runtime. Removing it also drops its transitive `expo-firebase-core`.
- Deleted `patches/expo-firebase-core+6.0.0.patch` and the `expo.autolinking.exclude: ["expo-firebase-core"]` entry in `package.json` — both only existed to work around `expo-firebase-core`.
- Ran `npm audit fix` (non-breaking fixes only). `npm audit` went from **88 → 72** findings; all **3 critical** and both **low** findings are gone (protobufjs, shell-quote, websocket-driver, @babel/core, @tootallnate/once, ws, nanoid, form-data, js-yaml, etc.). 36 transitive packages changed, 3 removed.

## What remains in `npm audit` (72) and why it was left alone
Every remaining finding needs a **major** upgrade of a framework-level dependency (Expo SDK, React Native, Jest, Firebase) and is not fixable inside SDK 54 without `--force`, which would break the app:

| Root package | Severity | Where it runs | Fix requires |
| --- | --- | --- | --- |
| `node-forge`, `postcss`, `uuid` | high / moderate | Expo CLI / Metro **build tooling only** | Expo SDK major upgrade |
| `braces`, `sprintf-js` | high / moderate | Jest **dev tooling only** | Jest 30 (major) |
| `image-size` | high | Metro **build tooling only** | Metro pins 1.x; fixed in 2.x |
| `@grpc/grpc-js` | high | `@firebase/firestore` — the app does **not** import Firestore, so it is tree-shaken out of the bundle | Firebase major |
| `decode-uri-component` | moderate | `expo-router` → `query-string`, **ships in the app**. Risk: DoS via a malformed percent-encoded deep link. | expo-router 58 (major) |

Practical takeaway: only `decode-uri-component` is in shipped code, and it is a moderate-severity DoS reachable only through a crafted deep link. Re-run `npm audit` after the next Expo SDK upgrade, which clears most of the rest automatically.

## Validation
- `expo install --check`: Dependencies are up to date.
- `npm run check`: 0 TypeScript errors, 49 tests passed (5 suites).
- `expo export --platform ios`: Hermes bundle produced (JS-only check, not a native build).
- `patch-package` postinstall still runs and reports "No patch files found" — safe.

## Note
Removing a package with native code (`expo-firebase-recaptcha` pulled in a webview-based verifier and `expo-firebase-core`) changes the native build. Run an EAS / `expo prebuild --clean` build before TestFlight, together with the worklets change from the previous PR.