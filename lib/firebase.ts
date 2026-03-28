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
 * REST API HELPER for Firebase Auth
 * Since the Firebase JS SDK is failing to register its components in this Expo/Metro environment,
 * we use the Google Identity Toolkit REST API for maximum stability.
 */
export const AUTH_TOKEN_KEY = '@auth_token_v1';
export const AUTH_ID_TOKEN = '@auth_id_token_v1';

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
