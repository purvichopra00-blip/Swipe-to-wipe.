/**
 * PURE LOGIC AUDIT
 * This file extracts the core "math" and "decisions" of the app
 * so we can verify them WITHOUT needing a real phone or complex native environment.
 */

export const AppLogic = {
    // 1. Storage Math (From PhotoContext.tsx)
    calculateMB: (bytes: number) => bytes / (1024 * 1024),
    
    getDefaultSize: (mediaType: 'photo' | 'video') => {
        return mediaType === 'video' ? 15 * 1024 * 1024 : 3 * 1024 * 1024;
    },

    // 2. Ad Triggering (From Ads.ts)
    shouldShowAd: (swipeCount: number, adsShownThisSession: number) => {
        const schedule = [30, 20, 25, 15, 15];
        const minInterval = 15;
        const target = schedule[adsShownThisSession] || minInterval;
        return swipeCount >= target;
    },

    // 3. Calendar Filtering (From PhotoContext.tsx)
    // Returns the date range for any given filter
    getDateRange: (year: number, month?: number, day?: number) => {
        let start: Date, end: Date;
        if (day !== undefined && month !== undefined) {
            start = new Date(year, month, day);
            end = new Date(year, month, day + 1);
        } else if (month !== undefined) {
            start = new Date(year, month, 1);
            end = new Date(year, month + 1, 1);
        } else {
            start = new Date(year, 0, 1);
            end = new Date(year + 1, 0, 1);
        }
        return { start, end };
    }
};
