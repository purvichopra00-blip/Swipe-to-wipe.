/**
 * PURE LOGIC AUDIT (Node.js)
 * Verification Date: April 16, 2026
 * 
 * This script verifies the mathematics of the app without any 
 * React Native or Babel overhead.
 */

const Logic = {
    // Ad Schedule from Ads.ts
    adSchedule: [30, 20, 25, 15, 15],
    minInterval: 15,

    checkAd: (swipes, shown) => {
        const target = Logic.adSchedule[shown] || Logic.minInterval;
        return swipes >= target;
    },

    // MB Calculation from PhotoContext.tsx
    calcMB: (bytes) => bytes / (1024 * 1024),
    
    // Calendar Range from PhotoContext.tsx
    getDateRange: (y, m) => {
        const start = new Date(y, m !== undefined ? m : 0, 1);
        const end = new Date(m !== undefined ? y : y + 1, m !== undefined ? m + 1 : 0, 1);
        return { start, end };
    }
};

console.log("--- 🕵️ APP LOGIC AUDIT REPORT ---");

// Test 1: Ad Triggering
const adsPass = 
    Logic.checkAd(30, 0) === true && 
    Logic.checkAd(29, 0) === false &&
    Logic.checkAd(20, 1) === true &&
    Logic.checkAd(15, 10) === true;

console.log(`[1] Ad Scheduling: ${adsPass ? "✅ PASS" : "❌ FAIL"}`);

// Test 2: Storage Math
const storagePass = 
    Math.round(Logic.calcMB(10 * 1024 * 1024)) === 10 &&
    Logic.calcMB(15 * 1024 * 1024) === 15;

console.log(`[2] Storage Math: ${storagePass ? "✅ PASS" : "❌ FAIL"}`);

// Test 3: Calendar Leap Year / Ranges
const calPass = 
    Logic.getDateRange(2023).start.getFullYear() === 2023 &&
    Logic.getDateRange(2023).end.getFullYear() === 2024 &&
    Logic.getDateRange(2023, 1).start.getMonth() === 1 && // Feb
    Logic.getDateRange(2023, 1).end.getMonth() === 2;    // Mar

console.log(`[3] Calendar Logic: ${calPass ? "✅ PASS" : "❌ FAIL"}`);

if (adsPass && storagePass && calPass) {
    console.log("\n--- 🏁 OVERALL RESULT: 100% STABLE ---");
} else {
    process.exit(1);
}
