import { AD_CONFIG } from '../constants/Ads';

describe('Ad Scheduling Logic', () => {
  test('progressive schedule should follow the [30, 20, 25, 15, 15] pattern', () => {
    const schedule = AD_CONFIG.INTERSTITIAL_PROGRESSIVE_SCHEDULE;
    expect(schedule).toEqual([30, 20, 25, 15, 15]);
  });

  test('minimum interval should never be less than 15 for sustainability', () => {
    expect(AD_CONFIG.INTERSTITIAL_MIN_INTERVAL).toBeGreaterThanOrEqual(15);
  });

  test('utility simulation: ad should trigger at correct swipe counts', () => {
    // This simulates the counter in index.tsx
    let adsShownThisSession = 0;
    let swipeCounter = 0;
    const triggeredAt: number[] = [];

    const simulateSwipe = () => {
      swipeCounter++;
      const target = AD_CONFIG.INTERSTITIAL_PROGRESSIVE_SCHEDULE[adsShownThisSession] || AD_CONFIG.INTERSTITIAL_MIN_INTERVAL;
      if (swipeCounter >= target) {
        triggeredAt.push(swipeCounter);
        adsShownThisSession++;
        swipeCounter = 0;
      }
    };

    // Simulate 100 swipes
    for (let i = 0; i < 100; i++) {
      simulateSwipe();
    }

    // Expected triggers: 30, 20, 25, 15, 15... 
    // Total triggers expected: 30 + 20 + 25 + 15 + 15 + ...
    expect(triggeredAt[0]).toBe(30);
    expect(triggeredAt[1]).toBe(20);
    expect(triggeredAt[2]).toBe(25);
    expect(triggeredAt[3]).toBe(15);
  });
});
