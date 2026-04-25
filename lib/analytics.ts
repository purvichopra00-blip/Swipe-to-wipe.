import * as Amplitude from '@amplitude/analytics-react-native';

const AMPLITUDE_API_KEY = process.env.EXPO_PUBLIC_AMPLITUDE_API_KEY ?? '';

export const initAnalytics = () => {
    if (!AMPLITUDE_API_KEY || AMPLITUDE_API_KEY.includes('YOUR_') || AMPLITUDE_API_KEY.includes('your-')) {
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
