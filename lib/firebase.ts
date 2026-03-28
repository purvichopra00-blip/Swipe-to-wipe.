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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Using the simplest possible registration to avoid the internal crash
const auth = getAuth(app);

export { auth };
export default app;
