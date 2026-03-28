/**
 * AdMob Configuration
 * Replace these test IDs with your production AdMob IDs when publishing the app.
 */
export const AD_CONFIG = {
    // PRODUCTION BANNER ID (Replace with your actual AdMob Banner ID)
    BANNER_UNIT_ID: __DEV__ ? 'ca-app-pub-3940256099942544/6300978111' : 'ca-app-pub-4536210339227120/2940221892',

    // PRODUCTION INTERSTITIAL ID (Replace with your actual AdMob Interstitial ID)
    INTERSTITIAL_UNIT_ID: __DEV__ ? 'ca-app-pub-3940256099942544/1033173712' : 'ca-app-pub-4536210339227120/7749220084',

    // How many swipes before showing an interstitial
    SWIPES_PER_INTERSTITIAL: 15,
};
