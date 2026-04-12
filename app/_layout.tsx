import 'react-native-get-random-values';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PhotoProvider } from '../contexts/PhotoContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONBOARDING_COMPLETED_KEY } from './onboarding';
import { AUTH_TOKEN_KEY } from './(auth)/login';
import { PERMISSIONS_GRANTED_KEY } from './permissions';
import { useState, useEffect } from 'react';
import { Alert, Linking, Platform, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Syne_700Bold, Syne_800ExtraBold } from '@expo-google-fonts/syne';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { initAds } from '../lib/ads';
import { initAnalytics, logEvent, TrackEvents } from '../lib/analytics';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const router = useRouter();
    const segments = useSegments();
    const [isReady, setIsReady] = useState(false);
    const [splashHidden, setSplashHidden] = useState(false);
    const [isOffline, setIsOffline] = useState(false);

    const [fontsLoaded] = useFonts({
        Syne_700Bold,
        Syne_800ExtraBold,
        DMSans_400Regular,
        DMSans_500Medium,
        DMSans_700Bold,
    });

    useEffect(() => {
        async function prepare() {
            initAnalytics();
            await initAds();
            setIsReady(true);
            logEvent(TrackEvents.SESSION_START);
        }
        
        async function checkForAppUpdates() {
            try {
                if (Platform.OS === 'ios') {
                    const bundleId = Constants.expoConfig?.ios?.bundleIdentifier || 'com.purvichopra.swipetowipe';
                    const response = await fetch(`https://itunes.apple.com/lookup?bundleId=${bundleId}&t=${Date.now()}`);
                    const data = await response.json();
                    
                    if (data && data.resultCount > 0) {
                        const storeVersion = data.results[0].version;
                        const currentVersion = Constants.expoConfig?.version || '1.3.0';
                        const trackViewUrl = data.results[0].trackViewUrl;

                        const vStore = storeVersion.split('.').map(Number);
                        const vCurrent = currentVersion.split('.').map(Number);
                        
                        let isOutdated = false;
                        for (let i = 0; i < Math.max(vStore.length, vCurrent.length); i++) {
                            const s = vStore[i] || 0;
                            const c = vCurrent[i] || 0;
                            if (s > c) { isOutdated = true; break; }
                            if (s < c) { break; }
                        }

                        if (isOutdated && trackViewUrl) {
                            Alert.alert(
                                'Update Available! 🚀',
                                'A new version of Swipe to Wipe with bug fixes and new features is available on the App Store.',
                                [
                                    { text: 'Later', style: 'cancel' },
                                    { text: 'Update Now', style: 'default', onPress: () => Linking.openURL(trackViewUrl) }
                                ]
                            );
                        }
                    }
                }
            } catch (error) {
                console.log("App update check skipped", error);
            }
        }

        prepare();
        checkForAppUpdates();

        // Internet enforcement listener
        const unsubscribeNet = NetInfo.addEventListener(state => {
            setIsOffline(state.isConnected === false);
        });

        return () => unsubscribeNet();
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

            if (!splashHidden) {
                SplashScreen.hideAsync().catch(() => { });
                setSplashHidden(true);
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
                    </Stack>

                    {isOffline && (
                        <View style={s.offlineOverlay}>
                            <Ionicons name="wifi-outline" size={64} color="#ef4444" style={{ marginBottom: 20 }} />
                            <Text style={s.offlineTitle}>Connection Lost</Text>
                            <Text style={s.offlineSubtitle}>
                                An internet connection is strictly required to reliably load data and serve ads. Please reconnect to Wi-Fi or Cellular to continue using Swipe to Wipe.
                            </Text>
                        </View>
                    )}

                    <StatusBar style="dark" />
                </PhotoProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

const s = StyleSheet.create({
    offlineOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999999,
        elevation: 99999,
        backgroundColor: 'rgba(255,255,255,0.98)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 30,
    },
    offlineTitle: { fontFamily: 'Syne_800ExtraBold', fontSize: 26, color: '#1f2937', marginBottom: 12, textAlign: 'center' },
    offlineSubtitle: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24 },
});
