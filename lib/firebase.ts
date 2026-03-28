import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Initialize Auth with persistence (singleton pattern)
let auth;
try {
    auth = getAuth(app);
} catch (e) {
    auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage)
    });
}

export { auth };
export default app;
