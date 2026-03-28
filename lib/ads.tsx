import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AD_CONFIG } from '../constants/Ads';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Standard Google Mobile Ads constants that we always want available
export const BannerAdSize = {
    ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER',
    BANNER: 'BANNER',
    FULL_BANNER: 'FULL_BANNER',
    LARGE_BANNER: 'LARGE_BANNER',
    LEADERBOARD: 'LEADERBOARD',
    MEDIUM_RECTANGLE: 'MEDIUM_RECTANGLE',
    SMART_BANNER: 'SMART_BANNER',
    WIDE_SKYSCRAPER: 'WIDE_SKYSCRAPER',
};

export const AdEventType = {
    LOADED: 'loaded',
    ERROR: 'error',
    OPENED: 'opened',
    CLICKED: 'clicked',
    LEFT_APPLICATION: 'left_application',
    CLOSED: 'closed',
};

// Unit IDs imported from dedicated config file
export const AdUnits = {
    BANNER: AD_CONFIG.BANNER_UNIT_ID,
    INTERSTITIAL: AD_CONFIG.INTERSTITIAL_UNIT_ID,
};

// Real library imports (only if NOT in Expo Go)
let mobileAds: any = null;
let BannerAd: any = null;
let InterstitialAd: any = null;
let MaxAdContentRating: any = null;

if (!isExpoGo) {
    try {
        const ads = require('react-native-google-mobile-ads');
        mobileAds = ads.default;
        BannerAd = ads.BannerAd;
        InterstitialAd = ads.InterstitialAd;
        MaxAdContentRating = ads.MaxAdContentRating;

        // Use real values if available
        Object.assign(BannerAdSize, ads.BannerAdSize);
        Object.assign(AdEventType, ads.AdEventType);
    } catch (e) {
        console.warn("Google Mobile Ads library not found or native module missing.");
    }
}

export const initAds = async () => {
    if (isExpoGo || !mobileAds) {
        console.log('AdMob initialization skipped: Not supported in Expo Go');
        return;
    }
    try {
        await mobileAds().initialize();
        await mobileAds().setRequestConfiguration({
            maxAdContentRating: MaxAdContentRating?.G,
            tagForChildDirectedTreatment: false,
            tagForUnderAgeOfConsent: false,
        });
        console.log('AdMob initialized successfully');
    } catch (error) {
        console.error('AdMob initialization failed:', error);
    }
};

// Safe Banner Component
export const AppBannerAd = (props: any) => {
    if (isExpoGo || !BannerAd) {
        return (
            <View style={styles.mockBannerContainer}>
                <View style={styles.mockBannerContent}>
                    <View style={styles.testBadge}>
                        <Text style={styles.testBadgeText}>TEST AD</Text>
                    </View>
                    <Text style={styles.mockBannerText}>
                        Banner Placeholder (Expo Go)
                    </Text>
                </View>
            </View>
        );
    }
    return <BannerAd {...props} />;
};

// Safe Interstitial Loader
export const createSafeInterstitial = (unitId: string) => {
    if (isExpoGo || !InterstitialAd) {
        console.log('Interstitial Ad skipped: Not supported in Expo Go');
        return null;
    }
    try {
        return InterstitialAd.createForAdRequest(unitId, {
            requestNonPersonalizedAdsOnly: true,
        });
    } catch (e) {
        console.warn("Failed to create interstitial ad:", e);
        return null;
    }
};

const styles = StyleSheet.create({
    mockBannerContainer: {
        height: 60,
        width: '94%',
        backgroundColor: '#f8fafc',
        borderWidth: 1.5,
        borderColor: '#6366f1',
        borderRadius: 12,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 10,
        alignSelf: 'center',
    },
    mockBannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    testBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        backgroundColor: '#6366f1',
        borderRadius: 4,
    },
    testBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '900',
    },
    mockBannerText: {
        color: '#475569',
        fontSize: 13,
        fontWeight: '600',
    }
});

