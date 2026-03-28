import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PhotoProvider } from '../contexts/PhotoContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
    AUTH_TOKEN_KEY, 
    ONBOARDING_COMPLETED_KEY, 
    PERMISSIONS_GRANTED_KEY 
} from '../lib/firebase';
import { useState, useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Syne_700Bold, Syne_800ExtraBold } from '@expo-google-fonts/syne';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { initAds } from '../lib/ads';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const router = useRouter();
    const segments = useSegments();
    const [isReady, setIsReady] = useState(false);
    const isNavigatingRef = useRef(false);

    const [fontsLoaded] = useFonts({
        Syne_700Bold,
        Syne_800ExtraBold,
        DMSans_400Regular,
        DMSans_500Medium,
        DMSans_700Bold,
    });

    useEffect(() => {
        async function prepare() {
            try {
                await initAds();
            } catch (e) {
                console.warn('AdInit failed', e);
            } finally {
                setIsReady(true);
            }
        }
        prepare();
    }, []);

    // Stabilized Navigation Flow
    useEffect(() => {
        if (!isReady || !fontsLoaded || isNavigatingRef.current) return;

        async function checkFlow() {
            try {
                const [completed, token, permissions] = await Promise.all([
                    AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
                    AsyncStorage.getItem(AUTH_TOKEN_KEY),
                    AsyncStorage.getItem(PERMISSIONS_GRANTED_KEY)
                ]);

                // Flatten segments for robust comparison
                const segmentPath = segments.filter(Boolean).join('/');
                const rootSegment = segments[0];

                let targetRoute: string | null = null;

                if (completed !== 'true') {
                    if (rootSegment !== 'onboarding') {
                        targetRoute = '/onboarding';
                    }
                } else if (!token) {
                    // Check if we are outside of the (auth) group
                    if (rootSegment !== '(auth)' && rootSegment !== 'login') {
                        targetRoute = '/(auth)/login';
                    }
                } else if (permissions !== 'true') {
                    if (rootSegment !== 'permissions') {
                        targetRoute = '/permissions';
                    }
                } else {
                    // Check if we are outside of (tabs) or main swipe
                    if (rootSegment !== '(tabs)' && rootSegment !== 'swipe') {
                        targetRoute = '/(tabs)';
                    }
                }

                if (targetRoute) {
                    isNavigatingRef.current = true;
                    router.replace(targetRoute as any);
                    // Reset navigating flag after a delay to allow segment update
                    setTimeout(() => { isNavigatingRef.current = false; }, 500);
                } else {
                    // Flow is correct, hide splash
                    SplashScreen.hideAsync().catch(() => { });
                }
            } catch (err) {
                console.error('Flow check error', err);
            }
        }

        checkFlow();
    }, [isReady, fontsLoaded, segments]);

    if (!isReady || !fontsLoaded) return null;

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <PhotoProvider>
                    <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Screen name="onboarding" />
                        <Stack.Screen name="(auth)/login" />
                        <Stack.Screen name="(auth)/signup" />
                        <Stack.Screen name="permissions" />
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="swipe" options={{ presentation: 'fullScreenModal' }} />
                        <Stack.Screen name="+not-found" />
                    </Stack>
                    <StatusBar style="dark" />
                </PhotoProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
