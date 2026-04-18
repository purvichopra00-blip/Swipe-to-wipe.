import { initializeApp } from 'firebase/app';
// @ts-ignore – getReactNativePersistence typing varies across firebase SDK versions
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Your web app's Firebase configuration (Matched to production plist)
const firebaseConfig = {
    apiKey: "AIzaSyArGe4B5oP3c3sSO6GzZejJu13cwUlLQoM",
    authDomain: "swipe-to-wipe.firebaseapp.com",
    projectId: "swipe-to-wipe",
    storageBucket: "swipe-to-wipe.firebasestorage.app",
    messagingSenderId: "175347456697",
    appId: "1:175347456697:ios:d77d8018b8358a8e6c1968",
    measurementId: "G-QD6DNG6V0Y"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth with AsyncStorage persistence
export const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
});
