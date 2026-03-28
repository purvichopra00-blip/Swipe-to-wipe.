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
import { useState, useEffect } from 'react';
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

    const [fontsLoaded] = useFonts({
        Syne_700Bold,
        Syne_800ExtraBold,
        DMSans_400Regular,
        DMSans_500Medium,
        DMSans_700Bold,
    });

    useEffect(() => {
        async function prepare() {
            await initAds();
            setIsReady(true);
        }
        prepare();
    }, []);

    // Reactive Navigation Logic
    useEffect(() => {
        async function checkFlow() {
            if (!isReady || !fontsLoaded) return;

            const [completed, token, permissions] = await Promise.all([
                AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
                AsyncStorage.getItem(AUTH_TOKEN_KEY),
                AsyncStorage.getItem(PERMISSIONS_GRANTED_KEY)
            ]);

            const segment = segments[0];

            if (completed !== 'true') {
                if (segment !== 'onboarding') {
                    router.replace('/onboarding');
                }
            } else if (!token) {
                if (segment !== '(auth)') {
                    router.replace('/(auth)/login');
                }
            } else if (permissions !== 'true') {
                if (segment !== 'permissions') {
                    router.replace('/permissions');
                }
            } else {
                if (segment !== '(tabs)' && segment !== 'swipe') {
                    router.replace('/(tabs)');
                }
            }

            SplashScreen.hideAsync().catch(() => { });
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
