# TypeScript fixes — validation and remaining release checks

This change fixes the 58 TypeScript diagnostics reproduced on main at `937a2f6`.
It does **not** certify a native iOS build, solve the reported lock-screen restart,
or authorize a TestFlight/App Store upload.

## Changes

- Define the missing tutorial, celebration and progress styles rather than suppress their type errors.
- Remove the first duplicate bin header style, preserving the existing runtime-effective style.
- Initialize notification subscription refs for React 19.
- Normalize photo/video values passed to swipe-limit actions.
- Expose the existing rewarded-swipe action in the context interface.
- Migrate the purchase flow to the installed react-native-iap v15 APIs:
  `fetchProducts`, `displayPrice`, per-platform `requestPurchase`, and current cancellation codes.
- Accept only completed, nonrevoked `pro_upgrade` purchase events; ignore pending/unknown/unrelated results.
- Deduplicate native purchase callbacks and allow retry after transaction-finalization failure.
- Explicit restore requests call the SDK restore/sync API.
- Retain cached entitlement when store sync fails; a successful sync updates the cache.
- Cancel product retries and listeners on unmount.
- Keep Expo Go simulated entitlements in memory, without persisting paid access.
- Remove the paywall's hard-coded fallback price; use the store's localized display price.

No dependencies were upgraded, TypeScript strictness was not reduced, and no source files
were excluded from the project typecheck. No additional `any` assertions or suppression
directives were added to make the typecheck pass.

The native SDK purchase status is used here; this patch does not add server-side receipt
verification or cross-account entitlement synchronization.

## Reproduced automated results

| Check | Result |
|---|---|
| Before: `tsc --noEmit` on base main | 58 diagnostics |
| After: `npm run typecheck` | Passed, zero diagnostics |
| `npm test -- --runInBand` | 49 passing tests in 5 suites |
| Production Babel transforms, six changed source files | Passed |
| `expo export --platform ios` | Passed, 1,927 modules; iOS Hermes JS bundle exported |
| `git diff --check` | Passed |
| `expo install --check` | Failed: existing compatibility warnings listed below |

Use `npm run check` to run typecheck and tests together.

The new purchase tests mock native store APIs. They cover API payloads, localized price,
purchase-state/SKU/revocation checks, cancellation, failures/redelivery, restore/sync,
offline cache, Expo Go isolation, duplicate events, startup-sync race, listener/timer
cleanup and the existing rewarded-swipe budget.

## Release risks outside this TypeScript fix

### Dependency compatibility

The installed Worklets is `0.7.4`; Expo SDK 54's compatibility check expects `0.5.1`.
Assess the installed Reanimated/Worklets/native build combination before TestFlight.
This warning is **not evidence of the cause of the customer's restart**.

The check also recommends patch updates for Expo, expo-asset, expo-constants,
expo-dev-client, expo-file-system, expo-font, expo-linking, expo-localization,
expo-notifications, expo-router and jest-expo. They were left unchanged to avoid
mixing native dependency upgrades into this source/type repair.

### Firebase build configuration

The JS export reported missing/unreadable configured files:
`GoogleService-Info.plist` and `google-services.json`.
They are intentionally gitignored. Supply the correct app-specific files through a secure
local/build-service setup and verify that the EAS build receives them.
Do not commit secrets or paste signing credentials into the public bot.

### Native/device validation still required

- [ ] Resolve/validate the dependency compatibility warnings in a separate reviewed change.
- [ ] Provide the correct Firebase build configuration securely.
- [ ] Produce a signed native iOS build; JS export is not compilation/linking/signing.
- [ ] Test actual App Store sandbox/TestFlight product lookup and localized price.
- [ ] Test a successful purchase, user cancellation, pending/Ask to Buy, restore on a fresh install,
      offline start, and a revoked/refunded entitlement.
- [ ] Confirm transaction redelivery does not show duplicate success dialogs.
- [ ] Review newly defined tutorial/celebration layouts on small and large iPhones.
- [ ] Run `CUSTOMER_FEEDBACK_QA.md`, especially long mixed-media/iCloud sessions and
      the previously reported black-screen/lock-screen restart; collect device logs.
- [ ] Only after these checks, decide on TestFlight/App Store submission with Purvi.

No merge, native cloud build, TestFlight upload, signing change, or App Store submission
is part of this change request.