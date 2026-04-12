import { Platform } from 'react-native';

/**
 * AdMob Configuration
 * AdMob explicitly requires different ad units for iOS and Android.
 */

// Official Google Test IDs
const bannerTestId = Platform.OS === 'ios' ? 'ca-app-pub-3940256099942544/2934735716' : 'ca-app-pub-3940256099942544/6300978111';
const interstitialTestId = Platform.OS === 'ios' ? 'ca-app-pub-3940256099942544/4411468910' : 'ca-app-pub-3940256099942544/1033173712';

export const AD_CONFIG = {
    // PRODUCTION BANNER IDs
    BANNER_UNIT_ID: __DEV__ ? bannerTestId : (
        Platform.OS === 'ios' 
            ? 'ca-app-pub-4536210339227120/7941351227' 
            : 'ca-app-pub-4536210339227120/7941351227'
    ),

    // PRODUCTION INTERSTITIAL IDs
    INTERSTITIAL_UNIT_ID: __DEV__ ? interstitialTestId : (
        Platform.OS === 'ios' 
            ? 'ca-app-pub-4536210339227120/7749220084' 
            : 'ca-app-pub-4536210339227120/7749220084'
    ),

    // Progressive frequency: Custom schedule [40, 20, 25, 15, 15] (first ad at 40 swipes)
    INTERSTITIAL_PROGRESSIVE_SCHEDULE: [40, 20, 25, 15, 15],
    INTERSTITIAL_MIN_INTERVAL: 15,
};
