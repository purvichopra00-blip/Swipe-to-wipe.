import { AppLogic } from '../lib/audit-logic';

describe('🚀 Isolated Stability Audit (Zero-Native Proof)', () => {
    
    describe('📊 Storage Calculation Logic', () => {
        test('should correctly calculate MB from bytes', () => {
            const bytes = 10 * 1024 * 1024; // 10MB
            expect(AppLogic.calculateMB(bytes)).toBe(10);
        });

        test('should identify video default as 15MB', () => {
            const size = AppLogic.getDefaultSize('video');
            expect(AppLogic.calculateMB(size)).toBe(15);
        });

        test('should identify photo default as 3MB', () => {
            const size = AppLogic.getDefaultSize('photo');
            expect(AppLogic.calculateMB(size)).toBe(3);
        });
    });

    describe('📅 Calendar & Chronology Logic', () => {
        test('yearly filter should cover exactly 365/366 days', () => {
            const { start, end } = AppLogic.getDateRange(2023);
            expect(start.getFullYear()).toBe(2023);
            expect(start.getMonth()).toBe(0); // Jan
            expect(end.getFullYear()).toBe(2024);
            expect(end.getMonth()).toBe(0); // Jan 1st of next year
        });

        test('monthly filter should cover the whole month', () => {
            const { start, end } = AppLogic.getDateRange(2023, 1); // Feb
            expect(start.getMonth()).toBe(1);
            expect(end.getMonth()).toBe(2); // March 1st
        });
    });

    describe('💰 Ad Scheduling Logic', () => {
        test('should trigger ad exactly at swipe 30 for first ad', () => {
            expect(AppLogic.shouldShowAd(30, 0)).toBe(true);
            expect(AppLogic.shouldShowAd(29, 0)).toBe(false);
        });

        test('should trigger ad exactly at swipe 20 for second ad', () => {
            expect(AppLogic.shouldShowAd(20, 1)).toBe(true);
            expect(AppLogic.shouldShowAd(19, 1)).toBe(false);
        });

        test('should fall back to safe minimum of 15 swipes after schedule ends', () => {
            expect(AppLogic.shouldShowAd(15, 10)).toBe(true);
            expect(AppLogic.shouldShowAd(14, 10)).toBe(false);
        });
    });
});
