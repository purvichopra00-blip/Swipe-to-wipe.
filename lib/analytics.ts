import * as Amplitude from '@amplitude/analytics-react-native';
import Constants from 'expo-constants';

// Amplitude API Key
const AMPLITUDE_API_KEY = "587cd09bda71f1d0ffac00aad79c8fd1";

export const initAnalytics = () => {
    if (!AMPLITUDE_API_KEY || AMPLITUDE_API_KEY.includes('YOUR_')) {
        console.warn('Amplitude API Key is missing. Analytics will not be active.');
        return;
    }

    try {
        Amplitude.init(AMPLITUDE_API_KEY, undefined, {
            disableCookies: true,
        });
    } catch (err) {
        console.error('Amplitude init failed:', err);
    }
};

export const logEvent = (eventName: string, eventProperties?: Record<string, any>) => {
    Amplitude.track(eventName, eventProperties);
};

// Standardized event helpers
export const TrackEvents = {
    SESSION_START: 'session_start',
    ONBOARDING_COMPLETE: 'onboarding_complete',
    AUTH_SUCCESS: 'auth_success',
    SWIPE: 'swipe',
    PHOTOS_DELETED: 'photos_deleted',
    MILESTONE_REACHED: 'milestone_reached',
};
