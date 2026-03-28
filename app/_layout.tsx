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

function NavigationGuard() {
    const router = useRouter();
    const segments = useSegments();
    const isNavigating = useRef(false);
    const [isFlowChecked, setIsFlowChecked] = useState(false);

    useEffect(() => {
        async function checkFlow() {
            if (isNavigating.current) return;

            try {
                // Wait for a small beat to ensure AsyncStorage is settled if we just came from setItem
                await new Promise(r => setTimeout(r, 100));

                const [completed, token, permissions] = await Promise.all([
                    AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
                    AsyncStorage.getItem(AUTH_TOKEN_KEY),
                    AsyncStorage.getItem(PERMISSIONS_GRANTED_KEY)
                ]);

                const rootSegment = segments[0];
                let targetRoute: string | null = null;

                if (completed !== 'true') {
                    if (rootSegment !== 'onboarding') {
                        targetRoute = '/onboarding';
                    }
                } else if (!token) {
                    if (rootSegment !== '(auth)' && rootSegment !== 'login') {
                        targetRoute = '/(auth)/login';
                    }
                } else if (permissions !== 'true') {
                    if (rootSegment !== 'permissions') {
                        targetRoute = '/permissions';
                    }
                } else {
                    if (rootSegment !== '(tabs)' && rootSegment !== 'swipe') {
                        targetRoute = '/(tabs)';
                    }
                }

                if (targetRoute) {
                    isNavigating.current = true;
                    router.replace(targetRoute as any);
                    // Unlock navigation after a longer delay to ensure segments hit the state
                    setTimeout(() => { isNavigating.current = false; }, 1000);
                } else {
                    SplashScreen.hideAsync().catch(() => { });
                }
            } catch (err) {
                console.error('Guard error', err);
            } finally {
                setIsFlowChecked(true);
            }
        }

        checkFlow();
    }, [segments]);

    return null;
}

export default function RootLayout() {
    const [isReady, setIsReady] = useState(false);

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
            } finally {
                setIsReady(true);
            }
        }
        prepare();
    }, []);

    if (!isReady || !fontsLoaded) return null;

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <PhotoProvider>
                    <NavigationGuard />
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
