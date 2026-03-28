import 'react-native-get-random-values';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyBV7kIh8wXvBsY6ZWRMc8jqtT38XScs1u4",
    authDomain: "swipe-to-wipe.firebaseapp.com",
    projectId: "swipe-to-wipe",
    storageBucket: "swipe-to-wipe.firebasestorage.app",
    messagingSenderId: "175347456697",
    appId: "1:175347456697:web:e94de59b7892867d6c1968",
    measurementId: "G-QD6DNG6V0Y"
};

// Singleton App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Simple lazy auth without advanced persistence to avoid crashing
let authInstance: any = null;
export const getFirebaseAuth = () => {
    if (!authInstance) authInstance = getAuth(app);
    return authInstance;
};

export default app;
