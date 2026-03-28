import 'react-native-get-random-values';
import { initializeApp, getApp, getApps } from 'firebase/app';

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBV7kIh8wXvBsY6ZWRMc8jqtT38XScs1u4",
    authDomain: "swipe-to-wipe.firebaseapp.com",
    projectId: "swipe-to-wipe",
    storageBucket: "swipe-to-wipe.firebasestorage.app",
    messagingSenderId: "175347456697",
    appId: "1:175347456697:web:e94de59b7892867d6c1968",
    measurementId: "G-QD6DNG6V0Y"
};

// Initialize Firebase (singleton pattern)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * AUTH STORAGE KEYS
 * Bump versions to V5 to ensure a "Clean Slate" and resolve the onboarding loop.
 */
export const AUTH_TOKEN_KEY = '@auth_token_v5';
export const AUTH_ID_TOKEN = '@auth_id_token_v5';
export const ONBOARDING_COMPLETED_KEY = '@onboarding_completed_v5';
export const PERMISSIONS_GRANTED_KEY = '@permissions_granted_v5';

/**
 * REST API HELPER for Firebase Auth
 */
export const firebaseAuthREST = async (endpoint: string, body: any) => {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${firebaseConfig.apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return response.json();
};

export default app;
