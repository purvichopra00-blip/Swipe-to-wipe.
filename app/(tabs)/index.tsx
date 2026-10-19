import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    StyleSheet, Text, View, Dimensions, Pressable,
    Modal, Animated as RNAnimated, StatusBar, Platform, TextInput, Alert, Share,
    ActivityIndicator, ScrollView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Sharing from 'expo-sharing';
import { Image } from 'expo-image';
import Animated, {
    useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, Easing,
    interpolate, Extrapolation, withSequence, withRepeat, useDerivedValue, useAnimatedProps, withDelay,
    FadeInDown, cancelAnimation
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Paths, File, Directory } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { usePhotos, SortMode, DateFilter } from '../../contexts/PhotoContext';
import SwipeCard from '../../components/SwipeCard';
import { AppBannerAd, BannerAdSize, AdUnits, createSafeInterstitial, AdEventType } from '../../lib/ads';
import { AD_CONFIG } from '../../constants/Ads';
import { useIAP } from '../../contexts/IAPContext';
import Paywall from '../../components/Paywall';


const { width: W, height: H } = Dimensions.get('window');
const SWIPE_THRESHOLD = W * 0.22;
const VISIBLE_CARDS = 3;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function CountUp({ to, duration = 3000, style, delay = 0 }: { to: number; duration?: number; style?: any; delay?: number }) {
    const count = useSharedValue(0);
    useEffect(() => {
        count.value = withDelay(delay, withTiming(to, {
            duration,
            easing: Easing.out(Easing.exp)
        }));
    }, [to, delay, duration]);

    const animatedProps = useAnimatedProps(() => {
        return {
            text: Math.floor(count.value).toLocaleString(),
        } as any;
    });

    return (
        <AnimatedTextInput
            underlineColorAndroid="transparent"
            editable={false}
            defaultValue="0"
            scrollEnabled={false}
            style={[
                style,
                { padding: 0, margin: 0, textAlign: 'center', minWidth: 160, height: 44 }
            ]}
            animatedProps={animatedProps}
        />
    );
}

function ScalePress({ children, onPress, style, disabled }: { children: React.ReactNode, onPress?: () => void, style?: any, disabled?: boolean }) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }]
    }));

    return (
        <AnimatedPressable
            disabled={disabled}
            onPress={onPress}
            onPressIn={() => scale.value = withSpring(0.92, { damping: 10, stiffness: 400 })}
            onPressOut={() => scale.value = withSpring(1, { damping: 10, stiffness: 400 })}
            style={[style, animatedStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

// Continuous gentle pulse animation for the main CTA button
function CtaPulse({ children }: { children: React.ReactNode }) {
    const scale = useSharedValue(1);
    React.useEffect(() => {
        scale.value = withRepeat(
            withSequence(
                withTiming(1.04, { duration: 900, easing: Easing.inOut(Easing.ease) }),
                withTiming(1.0,  { duration: 900, easing: Easing.inOut(Easing.ease) })
            ),
            -1,
            true
        );
    }, []);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }]
    }));
    return <Animated.View style={[{ alignSelf: 'stretch' }, animatedStyle]}>{children}</Animated.View>;
}

const RollModal = ({ visible, onClose }: { visible: boolean; onClose: () => void }) => (
    <Modal visible={visible} transparent animationType="fade">
        <View style={s.modalOverlay}>
            <Animated.View entering={FadeInDown} style={s.rollCard}>
                <Text style={s.rollEmoji}>🔥</Text>
                <Text style={s.rollTitle}>You’re on a roll</Text>
                <Text style={s.rollSub}>50 free swipes daily. Go Pro for unlimited.</Text>
                <ScalePress style={s.rollBtn} onPress={onClose}>
                    <Text style={s.rollBtnText}>Keep Going →</Text>
                </ScalePress>
            </Animated.View>
        </View>
    </Modal>
);

const SettingsModal = ({
    visible,
    onClose,
    isPro,
    onUpgrade,
    onSignOut,
    onDeleteAccount,
    totalClearedBytes,
    totalDeletedPhotos,
    fmt,
    onResetSwipes
}: {
    visible: boolean;
    onClose: () => void;
    isPro: boolean;
    onUpgrade: () => void;
    onSignOut: () => void;
    onDeleteAccount: () => void;
    totalClearedBytes: number;
    totalDeletedPhotos: number;
    fmt: (b: number) => string;
    onResetSwipes?: () => void;
}) => (
    <Modal
        visible={visible}
        animationType="fade"
        transparent={true}
        onRequestClose={onClose}
    >
        <Pressable
            style={s.settingsOverlay}
            onPress={onClose}
        >
            <Animated.View
                entering={FadeInDown.duration(300).springify()}
                style={s.settingsContent}
            >
                <View style={s.settingsHeader}>
                    <Text style={s.settingsTitle}>Settings</Text>
                    <Pressable onPress={onClose} style={s.settingsClose}>
                        <Ionicons name="close" size={20} color="#6B7280" />
                    </Pressable>
                </View>

                {/* Lifetime Impact Stats */}
                <View style={s.settingsStatsBox}>
                    <View style={s.settingsStatItem}>
                        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(52,199,89,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                            <Ionicons name="cloud-done-outline" size={18} color="#34C759" />
                        </View>
                        <Text style={s.settingsStatVal}>{fmt(totalClearedBytes)}</Text>
                        <Text style={s.settingsStatLbl}>Estimated deleted size</Text>
                    </View>
                    <View style={{ width: 1, height: 40, backgroundColor: '#EDEDED' }} />
                    <View style={s.settingsStatItem}>
                        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,107,107,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                            <Ionicons name="trash-outline" size={18} color="#FF6B6B" />
                        </View>
                        <Text style={s.settingsStatVal}>{totalDeletedPhotos.toLocaleString()}</Text>
                        <Text style={s.settingsStatLbl}>Items Deleted</Text>
                    </View>
                </View>

                <View style={s.settingsList}>
                    {!isPro ? (
                        <ScalePress
                            style={[s.settingsOption, { backgroundColor: '#FFF5F5', borderColor: '#FFE4E4' }]}
                            onPress={() => {
                                onClose();
                                onUpgrade();
                            }}
                        >
                            <View style={[s.settingsIconWrap, { backgroundColor: '#FF6B6B' }]}>
                                <Ionicons name="sparkles" size={20} color="#FFFFFF" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.settingsOptionTxt, { fontWeight: '700' }]}>Upgrade to Pro</Text>
                                <Text style={{ fontSize: 12, color: '#FF6B6B', marginTop: 1 }}>Unlock unlimited swipes</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#FF6B6B" />
                        </ScalePress>
                    ) : (
                        <ScalePress
                            style={s.settingsOption}
                            onPress={() => {
                                onClose();
                                onSignOut();
                            }}
                        >
                            <View style={[s.settingsIconWrap, { backgroundColor: '#F3F4F6' }]}>
                                <Ionicons name="log-out-outline" size={20} color="#4B5563" />
                            </View>
                            <Text style={s.settingsOptionTxt}>Sign Out</Text>
                            <Ionicons name="chevron-forward" size={18} color="#A1A1AA" />
                        </ScalePress>
                    )}

                    <ScalePress
                        style={s.settingsOption}
                        onPress={() => {
                            onClose();
                            onDeleteAccount();
                        }}
                    >
                        <View style={[s.settingsIconWrap, { backgroundColor: '#FEF2F2' }]}>
                            <Ionicons name="trash-bin-outline" size={20} color="#EF4444" />
                        </View>
                        <Text style={[s.settingsOptionTxt, { color: '#EF4444' }]}>Delete Account</Text>
                        <Ionicons name="chevron-forward" size={18} color="#FECACA" />
                    </ScalePress>
                </View>

                <View style={{ marginTop: 16, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: '#D1D5DB', fontWeight: '500' }}>Version {Constants.expoConfig?.version ?? '1.4.1'}</Text>
                </View>
            </Animated.View>
        </Pressable>
    </Modal>
);


function FadeSlideIn({ children, delay = 0, style }: any) {
    const progress = useSharedValue(0);

    useEffect(() => {
        progress.value = withDelay(delay, withTiming(1, { duration: 800, easing: Easing.out(Easing.back(1)) }));
    }, [delay]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ translateY: interpolate(progress.value, [0, 1], [30, 0], Extrapolation.CLAMP) }]
    }));

    return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

export default function SwipeScreen() {
    const {
        photos, currentIndex, currentPhoto, remainingCount,
        swipeRight, swipeLeft, undo, canUndo, sessionStats,
        isLoadingSession, scannedCount, sessionError, hasMore, loadMore, startSwipingSession, loadCategoryStats,
        sortMode, setSortMode, endSession, permissionsGranted,
        categoryCounts, totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        streak, weeklySwipes,
        showIntro, setShowIntro,
        dateFilter, setDateFilter,
        showCalendar, setShowCalendar,
        isGuest, setUserToken, deepReset
    } = usePhotos();

    const fmt = (b: number) => {
        if (!b) return '0 B';
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
        if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
        return `${(b / 1024 ** 3).toFixed(2)} GB`;
    };


    const [isSettingsVisible, setIsSettingsVisible] = useState(false);
    const [swipesThisSession, setSwipesThisSession] = useState(0);
    const [showRollModal, setShowRollModal] = useState(false);


    const insets = useSafeAreaInsets();
    const router = useRouter();
    const handOpacity = useSharedValue(0);
    const handX = useSharedValue(0);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);

    const logoScale = useSharedValue(1);

    const [calScope, setCalScope] = useState<'day' | 'month' | 'year'>('month');
    const [calMediaType, setCalMediaType] = useState<'all' | 'photo' | 'video'>('all');
    const [oldestLibraryYear, setOldestLibraryYear] = useState(new Date().getFullYear() - 15);
    const [calViewDate, setCalViewDate] = useState(new Date());
    const [calSelectedDay, setCalSelectedDay] = useState<number | null>(new Date().getDate());
    const [calMonthStats, setCalMonthStats] = useState({ photos: 0, distinctDays: new Set<number>() });

    useEffect(() => {
        if (!showCalendar) return;
        let active = true;
        const year = calViewDate.getFullYear();
        const month = calViewDate.getMonth();

        MediaLibrary.getAssetsAsync({
            createdAfter: new Date(year, month, 1).getTime(),
            createdBefore: new Date(year, month + 1, 1).getTime(),
            first: 500,
            mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        }).then(result => {
            if (!active) return;
            const uniqueDays = new Set<number>();
            result.assets.forEach(a => {
                uniqueDays.add(new Date(a.creationTime).getDate());
            });
            setCalMonthStats({ photos: result.totalCount || 0, distinctDays: uniqueDays });

            setCalSelectedDay(prev => Math.min(prev || 1, new Date(year, month + 1, 0).getDate()));
        }).catch(() => { });
        return () => { active = false; };
    }, [showCalendar, calViewDate]);

    useEffect(() => {
        if (!showCalendar) return;
        let active = true;
        MediaLibrary.getAssetsAsync({
            first: 1,
            mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
            sortBy: [[MediaLibrary.SortBy.creationTime, true]],
        }).then(result => {
            if (active && result.assets[0]) setOldestLibraryYear(new Date(result.assets[0].creationTime).getFullYear());
        }).catch(() => {});
        return () => { active = false; };
    }, [showCalendar]);

    const navMonth = (delta: number) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCalViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
    };

    useEffect(() => {
        logoScale.value = withRepeat(
            withSequence(
                withTiming(1.06, { duration: 2500, easing: Easing.inOut(Easing.sin) }),
                withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.sin) })
            ),
            -1,
            true
        );
    }, []);

    const logoAnimStyle = useAnimatedStyle(() => ({
        transform: [{ scale: logoScale.value }]
    }));
    const [showSort, setShowSort] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const sortProgress = useSharedValue(0);
    const dateProgress = useSharedValue(0);
    const { calendarTutorialSeen, setCalendarTutorialSeen } = usePhotos();
    const [isPickerMode, setIsPickerMode] = useState(false);
    const [localCalTutVisible, setLocalCalTutVisible] = useState(false);
    const years = Array.from({ length: Math.max(1, new Date().getFullYear() - oldestLibraryYear + 1) }, (_, i) => new Date().getFullYear() - i);
    const months = ['Jan ❄️', 'Feb 💌', 'Mar 🍀', 'Apr 🌸', 'May 🌿', 'Jun ☀️', 'Jul 🍦', 'Aug 🌊', 'Sep 🍂', 'Oct 🎃', 'Nov 🧣', 'Dec 🎄'];

    const selectYearMonth = (year: number, month?: number) => {
        const newDate = new Date(year, month ?? calViewDate.getMonth(), 1);
        setCalViewDate(newDate);
        setIsPickerMode(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    };

    useEffect(() => {
        if (showCalendar && !calendarTutorialSeen) {
            setLocalCalTutVisible(true);
        }
    }, [showCalendar, calendarTutorialSeen]);

    const dismissCalTutorial = () => {
        setLocalCalTutVisible(false);
        setCalendarTutorialSeen(true);
    };

    // Sync animation with global calendar state
    useEffect(() => {
        if (showCalendar) {
            dateProgress.value = withSpring(1, { damping: 15, stiffness: 150 });
        } else {
            dateProgress.value = withTiming(0, { duration: 250 });
        }
    }, [showCalendar]);

    const activeCatRef = useRef<string>('Random');
    const soundRef = useRef<Audio.Sound | null>(null);

    const [showCelebration, setShowCelebration] = useState(false);
    const [lastCelebrationCount, setLastCelebrationCount] = useState(0);
    const [lastSwipedId, setLastSwipedId] = useState<string | null>(null);
    const [adTriggerCounter, setAdTriggerCounter] = useState(0);
    const [adsShownThisSession, setAdsShownThisSession] = useState(0);
    const [interstitial, setInterstitial] = useState<any>(null);
    const [adLoaded, setAdLoaded] = useState(false);
    const { isPro, canSwipe, trackSwipe, photoCount, videoCount, resetDailyLimits, photoSwipesRemaining } = useIAP();

    // Tester Monitor: Track swipe counts in real-time
    useEffect(() => {
        console.log(`[TESTER] Photo Swipes: ${photoCount}, Video Swipes: ${videoCount}, Total: ${(photoCount || 0) + (videoCount || 0)}`);
    }, [photoCount, videoCount]);

    const [paywallVisible, setPaywallVisible] = useState(false);
    const [paywallReason, setPaywallReason] = useState<'limit' | 'ad' | 'upgrade'>('limit');

    const [showFullPreview, setShowFullPreview] = useState(false);

    const handleSignOut = async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShowIntro(true);
        endSession();
        await AsyncStorage.removeItem('@auth_token_v1');
        router.replace('/login');
    };

    const handleDeleteAccount = async () => {
        Alert.alert(
            'Delete Account Permanently?',
            'This will permanently delete your account, saved preferences, and all app data. This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete Permanently',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deepReset();
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            router.replace('/login');
                        } catch (err: any) {
                            console.error('Delete account error', err);
                            Alert.alert('Error', 'Failed to delete account. Please try again.');
                        }
                    }
                }
            ]
        );
    };

    const params = useLocalSearchParams();

    useEffect(() => {
        if (params?.showPaywall === 'true') {
            setPaywallReason('limit');
            setPaywallVisible(true);
            router.setParams({ showPaywall: undefined });
        }
    }, [params?.showPaywall]);

    useEffect(() => {
        if (isPro) {
            setAdLoaded(false);
            return;
        }
        const ad = createSafeInterstitial(AdUnits.INTERSTITIAL);
        if (ad) {
            const unsubscribeLoaded = ad.addAdEventListener(AdEventType.LOADED, () => setAdLoaded(true));
            const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
                setAdLoaded(false);
                setAdTriggerCounter(0);
                setTimeout(() => { ad.load(); }, 1000);
            });
            ad.load();
            setInterstitial(ad);
            return () => {
                unsubscribeLoaded();
                unsubscribeClosed();
            };
        }
    }, []);

    const showAd = useCallback(() => {
        if (isPro) return; // Never show ads for Pro
        if (adLoaded && interstitial) {
            interstitial.show();
            // Paywall logic: After first ad shows and after every 2nd ad
            const schedule = [1, 3, 5, 7, 9, 11, 13, 15]; // Ad count indices that trigger paywall
            if (schedule.includes(adsShownThisSession + 1)) {
                setTimeout(() => {
                    setPaywallReason('ad');
                    setPaywallVisible(true);
                }, 1000); // Small delay after ad closes
            }
        } else {
            // If ad wasn't loaded by the time we hit the trigger, try loading it again.
            if (interstitial && !adLoaded) {
                interstitial.load();
            }
            setAdTriggerCounter(0); // Reset if ad failed
        }
    }, [adLoaded, interstitial, isPro, adsShownThisSession]);
    const celebScale = useRef(new RNAnimated.Value(0.8)).current;
    const celebOpacity = useRef(new RNAnimated.Value(0)).current;
    const orbitSpin = useRef(new RNAnimated.Value(0)).current;
    const [storage, setStorage] = useState<{ used: number; total: number } | null>(null);
    const hasInitialAutoStarted = useRef(false);

    // Image Pre-loading: Handled by PhotoContext automatically
    // Removed local redundant prefetch to save memory and CPU cycles.

    // Auto start session ONLY after intro is finished or if intro is skipped
    useFocusEffect(
        useCallback(() => {
            if (!showIntro && permissionsGranted && remainingCount === 0 && !isLoadingSession && !hasInitialAutoStarted.current) {
                hasInitialAutoStarted.current = true;
                startSwipingSession('Random');
            }
        }, [showIntro, permissionsGranted, remainingCount, isLoadingSession, startSwipingSession])
    );

    useEffect(() => {
        if (!showIntro && permissionsGranted && remainingCount === 0 && !isLoadingSession && !currentPhoto && !hasInitialAutoStarted.current) {
            hasInitialAutoStarted.current = true;
            startSwipingSession('Random');
        }
    }, [showIntro, permissionsGranted, remainingCount, isLoadingSession, currentPhoto, startSwipingSession]);

    useEffect(() => {
        if (permissionsGranted) {
            loadCategoryStats();
        }
    }, [permissionsGranted]);

    const enterSession = (category: string) => {
        activeCatRef.current = category;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setDateFilter(null);
        startSwipingSession(category, null);
        setShowIntro(false);
    };

    // Auto transition REMOVED as per user request - User must tap manually.


    // Greeter removed (using global helper)

    // Force redirect back to onboarding if they haven't seen v4 yet
    useFocusEffect(
        useCallback(() => {
            AsyncStorage.getItem('@onboarding_completed_v4').then(res => {
                if (res !== 'true') router.replace('/onboarding');
            });
        }, [router])
    );

    // Start orbit animation loop
    useEffect(() => {
        const anim = RNAnimated.loop(
            RNAnimated.timing(orbitSpin, {
                toValue: 1, duration: 4000, easing: Easing.linear as any, useNativeDriver: true
            })
        );
        anim.start();
        return () => anim.stop();
    }, []);

    // Smart Celebration Trigger
    useEffect(() => {
        if (sessionStats.swiped > 0 && sessionStats.swiped % 100 === 0 && sessionStats.swiped !== lastCelebrationCount) {
            setLastCelebrationCount(sessionStats.swiped);
            setShowCelebration(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            RNAnimated.parallel([
                RNAnimated.spring(celebScale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
                RNAnimated.timing(celebOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
            ]).start();
        }
    }, [sessionStats.swiped, lastCelebrationCount]);

    const closeCelebration = () => {
        RNAnimated.parallel([
            RNAnimated.timing(celebScale, { toValue: 0.9, duration: 150, useNativeDriver: true }),
            RNAnimated.timing(celebOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        ]).start(() => setShowCelebration(false));
    };

    useEffect(() => {
        Audio.Sound.createAsync(
            { uri: 'https://www.soundjay.com/buttons/sounds/button-4.mp3' },
            { shouldPlay: false, volume: 0.4 }
        ).then(({ sound }) => {
            soundRef.current = sound;
        }).catch(() => { });
        return () => { soundRef.current?.unloadAsync(); };
    }, []);

    const playDeleteSound = useCallback(async () => {
        try { await soundRef.current?.replayAsync(); } catch { }
    }, []);

    const handleBack = useCallback(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        endSession();
        setDateFilter(null);
        setShowIntro(true);
    }, [endSession, setDateFilter, setShowIntro]);

    const openSort = () => {
        setShowSort(true);
        sortProgress.value = withSpring(1, { damping: 15, stiffness: 150 });
    };
    const closeSort = () => {
        sortProgress.value = withTiming(0, { duration: 250 }, () => runOnJS(setShowSort)(false));
    };
    const selectSort = useCallback(async (mode: SortMode) => {
        setSortMode(mode);
        closeSort();
        await startSwipingSession(activeCatRef.current, dateFilter, mode);
    }, [setSortMode, startSwipingSession, dateFilter]);

    const openDatePicker = () => {
        setShowCalendar(true);
        dateProgress.value = withSpring(1, { damping: 15, stiffness: 150 });
    };
    const closeDatePicker = () => {
        setShowCalendar(false);
    };

    const selectDate = useCallback(async (year?: number, month?: number, day?: number, autoJump = false) => {
        const newFilter = year ? { year, month, day } : null;
        setDateFilter(newFilter);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        if (autoJump || !year) {
            closeDatePicker();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            startSwipingSession('Random', newFilter);
        }
    }, [setDateFilter, startSwipingSession]);

    const confirmTimeJump = () => {
        closeDatePicker();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        startSwipingSession('Random', dateFilter);
    };

    const dateDragY = useSharedValue(0);
    const dateSheetStyle = useAnimatedStyle(() => ({
        opacity: withTiming(dateProgress.value > 0 ? 1 : 0, { duration: 150 }),
        transform: [{
            translateY: interpolate(dateProgress.value, [0, 1], [H * 0.8, 0], Extrapolation.CLAMP) + dateDragY.value
        }]
    }));

    const datePanGesture = Gesture.Pan()
        .onUpdate((e) => {
            if (e.translationY > 0) dateDragY.value = e.translationY;
        })
        .onEnd((e) => {
            if (e.translationY > 120 || e.velocityY > 600) {
                runOnJS(closeDatePicker)();
                dateDragY.value = withTiming(H);
            } else {
                dateDragY.value = withSpring(0);
            }
        });

    useEffect(() => {
        if (showCalendar) {
            dateDragY.value = 0;
        }
    }, [showCalendar]);

    const getProTip = () => {
        const total = categoryCounts.total || 1;
        // If videos make up more than 20% of the gallery
        if (categoryCounts.videos > total * 0.2) {
            return {
                text: "Videos take up 100x more space than photos! Start there to free up GBs fast.",
                action: () => { closeDatePicker(); startSwipingSession('Videos', null); }
            };
        }
        const lastYear = new Date().getFullYear() - 1;
        return {
            text: `${lastYear} usually has the most hidden clutter - clean it first!`,
            action: () => selectDate(lastYear, undefined, undefined, true)
        };
    };
    const currentProTip = getProTip();

    // Swipe Tutorial Logic (Progressive Disclosure)
    const TUTORIAL_SEEN_KEY = '@swipe_tutorial_v10';
    const [tutorialStepState, _setTutorialStep] = useState<0 | 1 | 2 | 3>(0);
    const [previewVideoUri, setPreviewVideoUri] = useState<string | null>(null);

    const fullPlayer = useVideoPlayer(showFullPreview && currentPhoto?.mediaType === 'video' ? (previewVideoUri || currentPhoto.url) : null, (p) => {
        p.loop = true;
        p.play();
    });

    useEffect(() => {
        let active = true;
        if (showFullPreview && currentPhoto?.mediaType === 'video') {
            const photoId = currentPhoto.id;
            MediaLibrary.getAssetInfoAsync(photoId).then(info => {
                if (active) setPreviewVideoUri(info.localUri || info.uri);
            }).catch(() => { });
        } else {
            setPreviewVideoUri(null);
        }
        return () => { active = false; };
    }, [showFullPreview, currentPhoto]);
    const tutorialStepRef = useRef<0 | 1 | 2 | 3>(0);
    const isTutorialActive = useSharedValue(false);
    const hasCheckedTutorial = useRef(false);

    const setTutorialStep = useCallback((step: 0 | 1 | 2 | 3) => {
        tutorialStepRef.current = step;
        isTutorialActive.value = (step === 1);
        _setTutorialStep(step);
    }, [isTutorialActive]);

    // Completely bulletproof trigger: wait until intro is DEAD, then fire after 1 second.
    useEffect(() => {
        if (!showIntro && currentPhoto && !isLoadingSession && !hasCheckedTutorial.current) {
            hasCheckedTutorial.current = true;
            AsyncStorage.getItem(TUTORIAL_SEEN_KEY).then(step => {
                if (!step) {
                    setTimeout(() => setTutorialStep(1), 500); // give it a beat to render before spawning ghosts
                } else if (step === '1' || step === '2') {
                    setTutorialStep(2); // Fast forward to waiting for a delete swipe
                } else if (step === '3') {
                    setTutorialStep(3); // In case they closed during the modal
                }
            });
        }
    }, [showIntro, currentPhoto, isLoadingSession]);

    const completeTutorial = useCallback(() => {
        setTutorialStep(0);
        AsyncStorage.setItem(TUTORIAL_SEEN_KEY, 'done');
    }, []);

    useEffect(() => {
        if (tutorialStepState === 1) {
            handOpacity.value = withTiming(1, { duration: 400 });
            translateX.value = withRepeat(
                withSequence(
                    withTiming(0, { duration: 600 }),
                    withTiming(-SWIPE_THRESHOLD * 1.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                    withTiming(0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
                    withTiming(SWIPE_THRESHOLD * 1.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                    withTiming(0, { duration: 800, easing: Easing.inOut(Easing.ease) })
                ),
                -1 // loop infinitely
            );
        } else {
            handOpacity.value = withTiming(0, { duration: 300 });
        }
    }, [tutorialStepState]);

    const handStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { translateX: translateX.value },
                { translateY: 60 },
                { scale: handOpacity.value }
            ],
            opacity: handOpacity.value
        };
    });

    const sortSheetStyle = useAnimatedStyle(() => ({
        opacity: sortProgress.value,
        transform: [{ translateY: interpolate(sortProgress.value, [0, 1], [400, 0], Extrapolation.CLAMP) }]
    }));

    const handleSwipeRight = useCallback(() => {
        if (!canSwipe(currentPhoto?.mediaType === 'video' ? 'video' : 'photo')) {
            setPaywallReason('limit');
            setPaywallVisible(true);
            // Re-center the card
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            return;
        }

        if (tutorialStepRef.current === 1) {
            setTutorialStep(2); // Ghost hands disappear, wait quietly for left swipe
            AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '2');
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        translateX.value = 0; // Reset FIRST to prevent new card from appearing off-screen
        translateY.value = 0;

        trackSwipe(currentPhoto?.mediaType === 'video' ? 'video' : 'photo');
        setSwipesThisSession(prev => {
            const next = prev + 1;
            if (next === 10) runOnJS(setShowRollModal)(true);
            return next;
        });

        swipeRight();
        setAdTriggerCounter(prev => {
            const next = prev + 1;
            const target = 25; // Trigger at exactly 25 swipes

            if (next >= target) {
                showAd();
                setAdsShownThisSession(s => s + 1);
                return 0; // Reset after triggering
            }
            return next;
        });
    }, [swipeRight, translateX, showAd, canSwipe, trackSwipe, currentPhoto, adsShownThisSession]);

    const handleSwipeLeft = useCallback(() => {
        if (!canSwipe(currentPhoto?.mediaType === 'video' ? 'video' : 'photo')) {
            setPaywallReason('limit');
            setPaywallVisible(true);
            // Re-center the card
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            return;
        }

        if (tutorialStepRef.current === 1 || tutorialStepRef.current === 2) {
            setTutorialStep(3); // Trigger Safe in Bin overlay
            AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '3');
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        playDeleteSound();
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        translateX.value = 0; // Reset FIRST
        translateY.value = 0;

        trackSwipe(currentPhoto?.mediaType === 'video' ? 'video' : 'photo');
        setSwipesThisSession(prev => {
            const next = prev + 1;
            if (next === 10) runOnJS(setShowRollModal)(true);
            return next;
        });

        swipeLeft();
        setAdTriggerCounter(prev => {
            const next = prev + 1;
            const target = 25; // Trigger at exactly 25 swipes

            if (next >= target) {
                showAd();
                setAdsShownThisSession(s => s + 1);
                return 0; // Reset after triggering
            }
            return next;
        });
    }, [swipeLeft, translateX, playDeleteSound, showAd, canSwipe, trackSwipe, currentPhoto, adsShownThisSession]);

    const panGesture = Gesture.Pan()
        .activeOffsetX([-10, 10]) // Prevent jitter on vertical scroll
        .onStart((e) => {
            if (isTutorialActive.value) {
                cancelAnimation(translateX);
                handOpacity.value = withTiming(0);
            }
        })
        .onUpdate((e) => {
            // Logarithmic resistance if pulled past threshold
            let newX = e.translationX;
            if (newX > SWIPE_THRESHOLD) {
                newX = SWIPE_THRESHOLD + (newX - SWIPE_THRESHOLD) * 0.6;
            } else if (newX < -SWIPE_THRESHOLD) {
                newX = -SWIPE_THRESHOLD + (newX + SWIPE_THRESHOLD) * 0.6;
            }
            translateX.value = newX;
            translateY.value = e.translationY;
            // Immediate haptic feedback on threshold cross
            if (
                (e.translationX > SWIPE_THRESHOLD && e.translationX - e.velocityX * 0.016 <= SWIPE_THRESHOLD) ||
                (e.translationX < -SWIPE_THRESHOLD && e.translationX - e.velocityX * 0.016 >= -SWIPE_THRESHOLD)
            ) { runOnJS(Haptics.selectionAsync)(); }
        })
        .onEnd((e) => {
            const velocityEffect = e.velocityX * 0.2; // Slightly more emphasis on velocity
            const finalX = e.translationX + velocityEffect;

            if (finalX > SWIPE_THRESHOLD) {
                const duration = Math.min(250, Math.max(150, 40000 / Math.abs(e.velocityX || 100)));
                translateX.value = withTiming(W * 1.5, { duration, easing: Easing.out(Easing.cubic) }, () => runOnJS(handleSwipeRight)());
                translateY.value = withTiming(e.translationY + e.velocityY * 0.3, { duration, easing: Easing.out(Easing.cubic) });
            } else if (finalX < -SWIPE_THRESHOLD) {
                const duration = Math.min(250, Math.max(150, 40000 / Math.abs(e.velocityX || 100)));
                translateX.value = withTiming(-W * 1.5, { duration, easing: Easing.out(Easing.cubic) }, () => runOnJS(handleSwipeLeft)());
                translateY.value = withTiming(e.translationY + e.velocityY * 0.3, { duration, easing: Easing.out(Easing.cubic) });
            } else {
                // Snap back with a nice bouncy spring
                translateX.value = withSpring(0, {
                    damping: 14, stiffness: 220, mass: 0.7, velocity: e.velocityX
                });
                translateY.value = withSpring(0, {
                    damping: 14, stiffness: 220, mass: 0.7, velocity: e.velocityY
                });
            }
        });

    const longPressGesture = Gesture.LongPress()
        .minDuration(400)
        .onStart(() => {
            runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
            runOnJS(setShowFullPreview)(true);
        });

    const combinedGesture = Gesture.Simultaneous(panGesture, longPressGesture);



    // Dynamic overlay colours from gesture
    const keepOverlay = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    }));
    const deleteOverlay = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, -SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    }));

    const renderCards = () => {
        if (!currentPhoto || !photos || !photos.length) return null;
        const cards = [];
        for (let i = VISIBLE_CARDS - 1; i >= 0; i--) {
            const idx = currentIndex + i;
            if (idx >= photos.length) continue;
            cards.push(
                <SwipeCard key={photos[idx].id} photo={photos[idx]} index={i}
                    totalVisible={VISIBLE_CARDS} translateX={translateX} translateY={translateY}
                    isTop={i === 0} hasFilter={!!dateFilter} onExpand={() => setShowFullPreview(true)} />
            );
        }
        return cards;
    };

    const sortLabel = sortMode === 'newest' ? 'Newest' : sortMode === 'oldest' ? 'Oldest' : 'Largest';


    /* â”€â”€â”€ INTRO SCREEN â”€â”€â”€ */
    const totalItems = categoryCounts.photos + categoryCounts.videos;
    const estMinutes = Math.ceil(totalItems / 100);


    const introScreen = (
        <View style={s.container}>
            <LinearGradient colors={['#FFFFFF', '#FFF5F1']} style={StyleSheet.absoluteFill} />
            <StatusBar barStyle="dark-content" />
            <SettingsModal
                visible={isSettingsVisible}
                onClose={() => setIsSettingsVisible(false)}
                isPro={isPro}
                onUpgrade={() => setPaywallVisible(true)}
                onSignOut={handleSignOut}
                onDeleteAccount={handleDeleteAccount}
                totalClearedBytes={totalClearedBytes}
                totalDeletedPhotos={totalDeletedPhotos}
                fmt={fmt}
                onResetSwipes={async () => {
                    await resetDailyLimits();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Debug Success', 'Daily swipes restored. 🛠️');
                }}
            />

            <ScrollView
                contentContainerStyle={[s.introScrollContent, { paddingTop: insets.top + 30, paddingBottom: (isPro ? 40 : 100) + insets.bottom }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Custom Header Row */}
                <View style={s.newHeaderRow}>
                    <View>
                        <Text style={[s.homeHeroSub, { color: '#FF6B6B', fontWeight: '700', marginBottom: -4, fontSize: 15 }]}>{getGreeting()},</Text>
                        <Text style={[s.homeHeroTitle, { fontSize: 32 }]}>Ready to clean?</Text>
                    </View>
                    <ScalePress style={s.newHeaderIconBg} onPress={() => setIsSettingsVisible(true)}>
                        <Ionicons name="settings-outline" size={22} color="#1C1C1E" />
                    </ScalePress>
                </View>

                {/* Hero Stats */}
                <View style={s.homeHero}>
                    <Text style={[s.homeHeroSub, { color: '#8E8E93', fontSize: 16, lineHeight: 24 }]}>
                        You have{' '}
                        <Text style={{ color: '#1C1C1E', fontWeight: '600' }}>
                            {categoryCounts.total.toLocaleString()} photos &amp; videos
                        </Text>
                        {' '}to review.{' '}
                        {isPro ? (
                            <Text style={{ color: '#FF6B6B', fontWeight: '700' }}>Cleaning without limits. 🚀</Text>
                        ) : (
                            <Text>Use your{' '}
                                <Text style={{ color: '#FF6B6B', fontWeight: '700' }}>free 50 swipes.</Text>
                            </Text>
                        )}
                    </Text>
                </View>

                {/* Impact Card (Lifetime Stats) */}
                {(totalClearedBytes > 0 || totalDeletedPhotos > 0) && (
                    <View style={s.impactCard}>
                        <LinearGradient colors={['#FF8E8E', '#FF6B6B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                        <View style={s.impactContent}>
                            <View style={s.impactHeader}>
                                <Text style={s.impactLabel}>LIFETIME IMPACT</Text>
                                <Ionicons name="sparkles" size={16} color="rgba(255,255,255,0.8)" />
                            </View>
                            <View style={s.impactStatsRow}>
                                <View style={s.impactStatItem}>
                                    <Text style={s.impactVal}>{fmt(totalClearedBytes).split(' ')[0]}<Text style={s.impactUnit}>{fmt(totalClearedBytes).split(' ')[1]}</Text></Text>
                                    <Text style={s.impactSub}>Estimated deleted size</Text>
                                </View>
                                <View style={s.impactDivider} />
                                <View style={s.impactStatItem}>
                                    <Text style={s.impactVal}>{totalDeletedPhotos.toLocaleString()}</Text>
                                    <Text style={s.impactSub}>Items Deleted</Text>
                                </View>
                                {streak > 1 && (
                                    <>
                                        <View style={s.impactDivider} />
                                        <View style={s.impactStatItem}>
                                            <Text style={s.impactVal}>{streak}</Text>
                                            <Text style={s.impactSub}>Day Streak</Text>
                                        </View>
                                    </>
                                )}
                            </View>
                        </View>
                    </View>
                )}

                {/* Main CTA */}
                <View style={{ alignItems: 'center', marginBottom: 24 }}>
                    <CtaPulse>
                        <ScalePress style={[s.mainCta, {
                            flexDirection: 'row',
                            justifyContent: 'center',
                            shadowColor: '#FF4444',
                            shadowOffset: { width: 0, height: 12 },
                            shadowOpacity: 0.45,
                            shadowRadius: 20,
                            elevation: 12,
                        }]} onPress={() => enterSession('Random')}>
                            <LinearGradient
                                colors={['#FF6B6B', '#FF9A5C']}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                                style={[StyleSheet.absoluteFill, { borderRadius: 32 }]}
                            />
                            <Text style={{ fontSize: 20, marginRight: 8 }}>🧹</Text>
                            <Text style={[s.mainCtaText, { fontSize: 20, fontWeight: '800' }]}>Start Swiping</Text>
                        </ScalePress>
                    </CtaPulse>
                    <Text style={{ fontFamily: 'System', color: '#A1A1AA', fontSize: 13, marginTop: 6, fontWeight: '500' }}>
                        {isPro ? '✨ Unlimited swipes activated' : `${photoSwipesRemaining} swipes left today`}
                    </Text>
                </View>

                {/* Category Grid */}
                <View style={s.catGrid}>
                    <View style={s.catCol}>
                        <ScalePress style={s.homeCatCard} onPress={() => enterSession('Screenshots')}>
                            <LinearGradient colors={['#6EE7B7', '#34D399']} style={s.catIcon}>
                                <Ionicons name="camera" size={24} color="#fff" />
                            </LinearGradient>
                            <Text style={s.homeCatTitle}>Screenshots</Text>
                            <Text style={s.homeCatSub}>{categoryCounts.screenshots} items</Text>
                        </ScalePress>

                        <ScalePress style={s.homeCatCard} onPress={() => enterSession('Videos')}>
                            <LinearGradient colors={['#FCA5A5', '#F87171']} style={s.catIcon}>
                                <Ionicons name="videocam" size={24} color="#fff" />
                            </LinearGradient>
                            <Text style={s.homeCatTitle}>Videos</Text>
                            <Text style={s.homeCatSub}>{categoryCounts.videos} items</Text>
                        </ScalePress>
                    </View>

                    <View style={s.catCol}>
                        <ScalePress style={s.homeCatCard} onPress={() => enterSession('Random')}>
                            <LinearGradient colors={['#93C5FD', '#60A5FA']} style={s.catIcon}>
                                <Ionicons name="shuffle" size={24} color="#fff" />
                            </LinearGradient>
                            <Text style={s.homeCatTitle}>Random Mix</Text>
                            <Text style={s.homeCatSub}>Clean everything</Text>
                        </ScalePress>

                        <ScalePress style={s.homeCatCard} onPress={openDatePicker}>
                            <LinearGradient colors={['#FCD34D', '#FBBF24']} style={s.catIcon}>
                                <Ionicons name="calendar" size={24} color="#fff" />
                            </LinearGradient>
                            <Text style={s.homeCatTitle}>Calendar</Text>
                            <Text style={s.homeCatSub}>{dateFilter ? `${dateFilter.year}${dateFilter.month !== undefined ? ` · ${months[dateFilter.month]}` : ''}` : 'Pick a year, month or day'}</Text>
                        </ScalePress>
                    </View>
                </View>
            </ScrollView>

            {/* Ad removed from home screen for breathability */}
        </View>
    );



    /* --- MAIN SWIPE SCREEN --- */
    const swipeScreen = (
        <View style={s.container}>
            <StatusBar barStyle="dark-content" />
            <RollModal visible={showRollModal} onClose={() => setShowRollModal(false)} />

            {/* Header Restructured */}
            <View style={[s.header, { paddingTop: Math.max(insets.top, 12), height: 70 + insets.top, paddingHorizontal: 20 }]}>
                <ScalePress
                    style={s.headerIconBg}
                    onPress={handleBack}
                >
                    <Ionicons name="chevron-back" size={22} color="#1C1C1E" />
                </ScalePress>

                <View style={s.headerPillContainer}>
                    <View style={s.swipePill}>
                        <Ionicons name="flash" size={14} color="#FF6B6B" />
                        <Text style={s.swipePillTxt}>{isPro ? 'Unlimited' : `${(photoCount || 0) + (videoCount || 0)}/50`}</Text>
                    </View>
                    <View style={s.statsPill}>
                        <Ionicons name="heart" size={14} color="#22C55E" />
                        <Text style={s.statsPillTxt}>{sessionStats.kept}</Text>
                        <View style={s.pillDivider} />
                        <Ionicons name="trash" size={14} color="#FF3B30" />
                        <Text style={s.statsPillTxt}>{sessionStats.deleted}</Text>
                    </View>
                </View>

                <ScalePress
                    style={s.headerIconBg}
                    onPress={() => router.push('/bin')}
                >
                    <Ionicons name="trash-outline" size={22} color="#1C1C1E" />
                </ScalePress>
            </View>


            {/* Cards Area */}
            <View style={s.cardArea}>

                {isLoadingSession ? (
                    <View style={s.emptyState}>
                        <ActivityIndicator size="large" color="#FF6B6B" />
                        <Text style={[s.emptySub, { marginTop: 20 }]}>Preparing your library{scannedCount > 0 ? ` · ${scannedCount.toLocaleString()} scanned` : ''}...</Text>
                        <Pressable onPress={handleBack}><Text style={{ color: '#FF6B6B', padding: 20 }}>Cancel</Text></Pressable>
                    </View>
                ) : sessionError ? (
                    <View style={s.emptyState}>
                        <Text style={s.emptySub}>{sessionError}</Text>
                        <Pressable accessibilityRole="button" onPress={() => hasMore ? loadMore() : startSwipingSession(activeCatRef.current, dateFilter)}>
                            <Text style={{ color: '#FF6B6B', padding: 20 }}>Retry</Text>
                        </Pressable>
                        <Pressable onPress={handleBack}><Text>Back to Dashboard</Text></Pressable>
                    </View>
                ) : !currentPhoto && hasMore ? (
                    <View style={s.emptyState}><ActivityIndicator color="#FF6B6B" /><Text>Loading more media...</Text></View>
                ) : currentPhoto ? (
                    <>
                        <View style={s.cardContainerWrapper}>
                        <GestureDetector gesture={combinedGesture}>
                            <Animated.View style={s.cardContainer}>
                                {renderCards()}
                            </Animated.View>
                        </GestureDetector>

                        {tutorialStepState === 1 && (
                            <Animated.View style={[s.ghostHandContainer, handStyle]} pointerEvents="none">
                                <View style={s.ghostHandLabels}>
                                    <Animated.View style={[s.ghostLabel, { opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) }]}>
                                        <View style={[s.ghostLabelPill, { backgroundColor: '#ff6b6b' }]}>
                                            <Ionicons name="heart" size={14} color="#fff" />
                                            <Text style={s.ghostLabelTxt}>Swipe Right to Keep</Text>
                                        </View>
                                    </Animated.View>
                                    <Animated.View style={[s.ghostLabel, { opacity: interpolate(translateX.value, [0, -SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) }]}>
                                        <View style={[s.ghostLabelPill, { backgroundColor: '#ff8e53' }]}>
                                            <Ionicons name="trash" size={14} color="#fff" />
                                            <Text style={s.ghostLabelTxt}>Swipe Left to Delete</Text>
                                        </View>
                                    </Animated.View>
                                </View>
                                <View style={s.ghostHandCircle}>
                                    <FontAwesome5 name="hand-pointer" size={30} color="#ffffff" style={{ marginLeft: 6, marginTop: 4, transform: [{ rotate: '-15deg' }] }} />
                                </View>
                            </Animated.View>
                        )}
                        </View>
                    </>
                ) : (
                    <View style={s.emptyState}>
                        <View style={s.emptyContent}>
                            <View style={s.emptyIconWrap}>
                                <Ionicons name="sparkles" size={50} color="#FF6B6B" />
                            </View>

                            <Text style={s.emptyTitle}>
                                {dateFilter && photos.length === 0 ? "No Photos Found" : "Squeaky Clean!"}
                            </Text>
                            <Text style={s.emptySub}>
                                {dateFilter
                                    ? (photos.length === 0
                                        ? "We couldn't find any photos or videos for this particular date."
                                        : "You've reviewed every photo from this date. Great job!")
                                    : "You've swiped through all your photos here. Mission accomplished!"}
                            </Text>
                        </View>

                        <View style={s.emptyActions}>
                            <ScalePress style={s.dashboardBtn} onPress={handleBack}>
                                <LinearGradient colors={['#FF8E8E', '#FF6B6B']} style={[StyleSheet.absoluteFill, { borderRadius: 32 }]} />
                                <Text style={s.dashboardBtnTxt}>Back to Dashboard</Text>
                            </ScalePress>

                            <ScalePress style={s.calendarBtn} onPress={() => {
                                handleBack();
                                setTimeout(() => setShowCalendar(true), 300);
                            }}>
                                <Ionicons name="calendar" size={20} color="#FF6B6B" />
                                <Text style={s.calendarBtnTxt}>Pick Another Date</Text>
                            </ScalePress>
                        </View>
                    </View>
                )}
            </View>

            {/* Step 3 (was 2) Tutorial Overlay (The Bin Pointer) */}
                {tutorialStepState === 3 && (
                    <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999, justifyContent: 'center' }]} pointerEvents="box-none">
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]} />

                        <Animated.View entering={FadeInDown.duration(600).delay(300).springify()} style={s.tutBinOverlay}>
                            <View style={s.tutIconWrap}>
                                <Ionicons name="shield-checkmark" size={44} color="#ff6b6b" />
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Text style={s.tutBinTitle}>Safe in the Bin!</Text>
                                <Ionicons name="shield-checkmark-outline" size={24} color="#ff6b6b" />
                            </View>
                            <Text style={s.tutBinDesc}>
                                Don't panic! Trashed photos are never deleted instantly. They wait safely in your <Text style={{ fontWeight: '800', color: '#fff' }}>Review Bin</Text> first.
                            </Text>
                            <Text style={s.tutBinDesc2}>
                                You can permanently delete them or restore them later.
                            </Text>

                            <ScalePress style={s.tutBinBtn} onPress={completeTutorial}>
                                <Text style={s.tutBinBtnText}>Got it!</Text>
                            </ScalePress>
                        </Animated.View>

                        <Animated.View style={s.tutArrowContainer}>
                            <RNAnimated.Text style={s.tutArrow}>↓</RNAnimated.Text>
                        </Animated.View>
                    </View>
                )}

                {/* Action Bar Consolidated */}
                {currentPhoto && (
                    <View style={[s.actions, { bottom: Math.max(insets.bottom, 12) + (isPro ? 24 : 70) }]}>
                        {/* Undo */}
                        <ScalePress
                            style={[s.smallBtn, { opacity: canUndo ? 1 : 0.5 }]}
                            onPress={() => {
                                if (!canUndo) return;
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                undo();
                            }}
                            disabled={!canUndo}
                        >
                            <Ionicons name="arrow-undo" size={22} color={canUndo ? "#1C1C1E" : "#cbd5e1"} />
                        </ScalePress>

                        {/* Delete */}
                        <ScalePress
                            style={s.mainBtn}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                playDeleteSound();
                                translateX.value = withSpring(-W * 1.5, { velocity: -500, stiffness: 200, damping: 20 }, () => runOnJS(handleSwipeLeft)());
                            }}
                        >
                            <Ionicons name="close" size={38} color="#FF3B30" />
                        </ScalePress>

                        {/* Heart */}
                        <ScalePress
                            style={s.mainBtn}
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                translateX.value = withSpring(W * 1.5, { velocity: 500, stiffness: 200, damping: 20 }, () => runOnJS(handleSwipeRight)());
                            }}
                        >
                            <Ionicons name="heart" size={34} color="#22C55E" />
                        </ScalePress>

                        {/* Share */}
                        <ScalePress
                            style={s.smallBtn}
                            disabled={isSharing}
                            onPress={async () => {
                                if (!currentPhoto || isSharing) return;
                                setIsSharing(true);
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                try {
                                    if (await Sharing.isAvailableAsync()) {
                                        const assetInfo = await MediaLibrary.getAssetInfoAsync(currentPhoto.id, { shouldDownloadFromNetwork: true });
                                        let shareUri = assetInfo.localUri || assetInfo.uri;

                                        if (!shareUri) {
                                            Alert.alert('Download Failed', 'Could not fetch this media. Please check your internet connection.');
                                            return;
                                        }

                                        const isVideo = currentPhoto.mediaType === 'video';
                                        const ext = currentPhoto.filename?.split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : 'jpg');

                                        if (!shareUri.startsWith('file://')) {
                                            try {
                                                const baseDir = Paths.cache.uri;
                                                const tmpDir = `${baseDir}/share_tmp/`;
                                                const tmpFile = `${tmpDir}${currentPhoto.id}.${ext}`;

                                                const dir = new Directory(tmpDir);
                                                if (!dir.exists) {
                                                    dir.create({ intermediates: true });
                                                }

                                                new File(shareUri).copy(new File(tmpFile));
                                                shareUri = tmpFile;
                                            } catch (err) {
                                                console.warn('Local resolution failed', err);
                                            }
                                        }

                                        const shareMessage = `Hey, look what I found while cleaning my phone! ✨\n\nGet Swipe to Wipe:\n🍎 iOS: https://apps.apple.com/us/app/swipe-to-wipe/id6761011430\n🤖 Android: https://play.google.com/store/apps/details?id=com.purvichopra.swipetowipe`;

                                        if (Platform.OS === 'ios') {
                                            if (currentPhoto.mediaType === 'photo') {
                                                try {
                                                    const manip = await ImageManipulator.manipulateAsync(
                                                        shareUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                                                    );
                                                    shareUri = manip.uri;
                                                } catch (e) { console.warn('HEIC conversion failed', e); }
                                            }

                                            await Share.share({
                                                url: shareUri,
                                                message: shareMessage,
                                            });
                                        } else {
                                            await Clipboard.setStringAsync(shareMessage);
                                            await Sharing.shareAsync(shareUri, {
                                                dialogTitle: 'Share with friends',
                                                mimeType: isVideo ? `video/${ext === 'mov' ? 'quicktime' : 'mp4'}` : "image/jpeg",
                                            });

                                            setTimeout(() => {
                                                Alert.alert(
                                                    "Message Copied!",
                                                    "Social apps on Android often skip the message when a file is shared directly. We've copied it to your clipboard so you can just 'Paste' it in the chat! ✨",
                                                    [{ text: "Got it!" }]
                                                );
                                            }, 800);
                                        }
                                    } else {
                                        Alert.alert('Sharing Unavailable', 'Sharing is not supported on this device.');
                                    }
                                } catch (err) {
                                    console.error('Sharing error:', err);
                                    Alert.alert('Error', 'Failed to prepare photo for sharing. Please ensure you have internet and try again.');
                                } finally {
                                    setIsSharing(false);
                                }
                            }}
                        >
                            <Ionicons name="paper-plane-outline" size={20} color="#1C1C1E" />
                        </ScalePress>
                        </View>
                    )}
            {/* End of Actions */}

            {/* Swipe Screen Ad Banner */}
            {!isPro && (
                <View style={s.homeAd}>
                    <AppBannerAd
                        unitId={AdUnits.BANNER}
                        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
                    />
                </View>
            )}
        </View>
    );

    return (
        <View style={s.container}>
            {showIntro ? introScreen : swipeScreen}

            {/* Celebration Popup */}
            <Modal visible={showCelebration} transparent animationType="none" onRequestClose={closeCelebration}>
                <Pressable style={s.celebOverlay} onPress={closeCelebration}>
                    <RNAnimated.View style={[s.celebCard, { opacity: celebOpacity, transform: [{ scale: celebScale }] }]}>
                        <LinearGradient colors={['rgba(255,107,107,0.08)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
                        <View style={s.celebShimmer} />
                        {showCelebration && (
                            <ConfettiCannon count={80} origin={{ x: W / 2, y: -20 }} fallSpeed={2500} fadeOut colors={['#ff6b6b', '#ff8e53', '#fca5a5', '#ec4899', '#fcd34d']} />
                        )}
                        <View style={s.celebIconWrap}>
                            <Text style={s.celebEmoji}>🎉</Text>
                            <RNAnimated.View style={[s.orbitContainer, { transform: [{ rotate: orbitSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
                                <View style={s.orbitDot} />
                            </RNAnimated.View>
                        </View>
                        <Text style={s.celebTitle}>{sessionStats.swiped} Photos Reviewed!</Text>
                        {sessionStats.mbFreed > 0 ? (
                            <View style={s.celebStorage}>
                                <Text style={s.celebStorageVal}>{sessionStats.mbFreed.toFixed(1)} <Text style={s.celebStorageUnit}>MB</Text></Text>
                                <Text style={s.celebStorageLbl}>Estimated space selected</Text>
                            </View>
                        ) : (
                            <View style={s.celebStorage}>
                                <Text style={s.celebStorageVal}>Keep going!</Text>
                                <Text style={s.celebStorageLbl}>No storage freed yet</Text>
                            </View>
                        )}
                        <View style={s.celebStatsCol}>
                            <View style={[s.celebStatRow, { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' }]}>
                                <View style={[s.celebStatIcon, { backgroundColor: 'rgba(239,68,68,0.2)' }]}>
                                    <Ionicons name="trash" size={16} color="#ff8e53" />
                                </View>
                                <Text style={[s.celebStatNum, { color: '#ff8e53' }]}>{sessionStats.deleted}</Text>
                                <Text style={s.celebStatLabel}>Moved to Bin</Text>
                            </View>
                            <View style={[s.celebStatRow, { backgroundColor: 'rgba(255,107,107,0.1)', borderColor: 'rgba(255,107,107,0.2)' }]}>
                                <View style={[s.celebStatIcon, { backgroundColor: 'rgba(255,107,107,0.2)' }]}>
                                    <Ionicons name="heart" size={16} color="#ff6b6b" />
                                </View>
                                <Text style={[s.celebStatNum, { color: '#ff6b6b' }]}>{sessionStats.kept}</Text>
                                <Text style={s.celebStatLabel}>Kept</Text>
                            </View>
                        </View>
                        <View style={s.progressWrap}>
                            <View style={s.progressHeader}>
                                <Text style={s.progressLbl}>Session Progress</Text>
                                <Text style={s.progressNum}>{sessionStats.swiped} / {sessionStats.swiped + remainingCount}</Text>
                            </View>
                            <View style={s.progressTrack}>
                                <View style={[s.progressFill, { width: `${(() => { const t = sessionStats.swiped + remainingCount; return t > 0 ? Math.min(100, (sessionStats.swiped / t) * 100) : 0; })()}%` }]} />
                            </View>
                        </View>
                        <Pressable style={({ pressed }) => [s.celebPrimaryBtn, pressed && { transform: [{ scale: 0.96 }] }]} onPress={closeCelebration}>
                            <LinearGradient colors={['#ff6b6b', '#ff8e53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.celebPrimaryGrad}>
                                <Text style={s.celebPrimaryTxt}>Continue Swiping</Text>
                            </LinearGradient>
                        </Pressable>
                        <Pressable style={s.celebSecBtn} onPress={() => { closeCelebration(); handleBack(); router.push('/bin'); }}>
                            <Text style={s.celebSecTxt}>View Bin</Text>
                        </Pressable>
                    </RNAnimated.View>
                </Pressable>
            </Modal>

            {/* Sort Sheet */}
            <Modal visible={showSort} transparent animationType="none" onRequestClose={closeSort}>
                <Pressable style={s.overlay} onPress={closeSort}>
                    <Animated.View
                        style={[s.sortSheet, sortSheetStyle]}
                    >
                        <LinearGradient colors={['#ffffff', '#fff0f5'] as [string, string]} style={StyleSheet.absoluteFill} />
                        <View style={s.sortHandle} />
                        <Text style={s.sortTitle}>Sort Gallery</Text>
                        <ScalePress style={[s.sortOpt, sortMode === 'newest' && { borderColor: '#ff6b6b', backgroundColor: '#fff5f5' }]} onPress={() => { setSortMode('newest'); closeSort(); }}>
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(255,107,107,0.1)' }]}><Ionicons name="time-outline" size={20} color="#ff6b6b" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'newest' && { color: '#ff6b6b', fontFamily: 'System' }]}>Newest First</Text>
                        </ScalePress>
                        <ScalePress style={[s.sortOpt, sortMode === 'oldest' && { borderColor: '#ff6b6b', backgroundColor: '#fff5f5' }]} onPress={() => { setSortMode('oldest'); closeSort(); }}>
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(255,107,107,0.1)' }]}><Ionicons name="hourglass-outline" size={20} color="#ff6b6b" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'oldest' && { color: '#ff6b6b', fontFamily: 'System' }]}>Oldest First</Text>
                        </ScalePress>
                        <ScalePress style={[s.sortOpt, sortMode === 'largest' && { borderColor: '#ff6b6b', backgroundColor: '#fff5f5' }]} onPress={() => { setSortMode('largest'); closeSort(); }}>
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(255,107,107,0.1)' }]}><Ionicons name="expand-outline" size={20} color="#ff6b6b" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'largest' && { color: '#ff6b6b', fontFamily: 'System' }]}>Largest First</Text>
                        </ScalePress>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Time Jump Modal */}
            <Modal visible={showCalendar} transparent animationType="none" onRequestClose={closeDatePicker}>
                <Pressable style={s.overlay} onPress={closeDatePicker}>
                    <GestureDetector gesture={datePanGesture}>
                        <Animated.View style={[s.sortSheet, dateSheetStyle]} onStartShouldSetResponder={() => true}>
                            <LinearGradient colors={['#ffffff', '#fffefe'] as [string, string]} style={StyleSheet.absoluteFill} />
                            <View style={s.sortHandle} />

                            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140, flexGrow: 1 }}>

                                {localCalTutVisible && (
                                    <Animated.View entering={FadeInDown.duration(600).springify()} style={[s.calTutCard, { marginVertical: 32 }]}>
                                        <View style={s.calTutIconWrap}>
                                            <Ionicons name="time" size={38} color="#ff6b6b" />
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <Text style={s.calTutTitle}>Clean your history</Text>
                                            <Ionicons name="sparkles-outline" size={20} color="#ff6b6b" />
                                        </View>
                                        <Text style={s.calTutDesc}>
                                            Pick a year or month to find and sweep away older photos.
                                        </Text>

                                        <ScalePress style={s.calTutBtn} onPress={dismissCalTutorial}>
                                            <Text style={s.calTutBtnText}>Got it</Text>
                                        </ScalePress>
                                    </Animated.View>
                                )}

                                {/* 1. Header Copy */}
                                <View style={{ marginBottom: 24, alignItems: 'center' }}>
                                    <View style={{ width: 44, height: 44, backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                                        <Ionicons name="calendar-outline" size={24} color="#ff6b6b" />
                                    </View>
                                    <Text style={{ fontFamily: 'System', fontSize: 24, color: '#1f2937', marginBottom: 4 }}>By Date</Text>
                                    <Text style={{ fontFamily: 'System', fontSize: 14, color: '#6b7280', textAlign: 'center' }}>Review a whole year, month, or a specific day</Text>
                                </View>

                                {/* 2. Banner */}
                                <View style={{ backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: 20, padding: 20, marginBottom: 24 }}>
                                    <Text style={{ fontFamily: 'System', fontSize: 12, color: '#ff6b6b', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>SELECTED MONTH</Text>
                                    <Text style={{ fontFamily: 'System', fontSize: 20, color: '#1f2937', marginBottom: 6 }}>
                                        {calMonthStats.photos} photos / videos
                                    </Text>
                                    <Text style={{ fontFamily: 'System', fontSize: 14, color: '#6b7280' }}>Choose a year, month or day below. Dots mark days in the loaded sample.</Text>
                                </View>

                                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                                    {(['year', 'month', 'day'] as const).map(scope => (
                                        <Pressable key={scope} accessibilityRole="button"
                                            accessibilityLabel={`Review entire ${scope}`}
                                            accessibilityState={{ selected: calScope === scope }}
                                            onPress={() => setCalScope(scope)}
                                            style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: calScope === scope ? '#FFE3E3' : '#F8F8FA' }}>
                                            <Text style={{ textAlign: 'center' }}>{scope === 'day' ? 'Day' : `Whole ${scope}`}</Text>
                                        </Pressable>
                                    ))}
                                </View>
                                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                                    {(['all', 'photo', 'video'] as const).map(type => (
                                        <Pressable key={type} accessibilityRole="button"
                                            accessibilityState={{ selected: calMediaType === type }}
                                            onPress={() => setCalMediaType(type)}
                                            style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: calMediaType === type ? '#FFE3E3' : '#F8F8FA' }}>
                                            <Text style={{ textAlign: 'center' }}>{type === 'all' ? 'All media' : type === 'photo' ? 'Photos' : 'Videos'}</Text>
                                        </Pressable>
                                    ))}
                                </View>

                                {/* 3. Navigation Header */}
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingHorizontal: 16 }}>
                                    <ScalePress onPress={() => navMonth(-1)}>
                                        <View style={{ padding: 8 }}>
                                            <Ionicons name="chevron-back" size={24} color="#FF6B6B" />
                                        </View>
                                    </ScalePress>

                                    <ScalePress
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setIsPickerMode(!isPickerMode);
                                        }}
                                        style={{ backgroundColor: isPickerMode ? 'rgba(255,107,107,0.1)' : 'transparent', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                                    >
                                        <Text style={{ fontFamily: 'System', fontSize: 17, fontWeight: '700', color: '#1C1C1E' }}>
                                            {calViewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                                            <Ionicons name={isPickerMode ? "chevron-up" : "chevron-down"} size={16} color="#FF6B6B" style={{ marginLeft: 4 }} />
                                        </Text>
                                    </ScalePress>

                                    <ScalePress onPress={() => navMonth(1)}>
                                        <View style={{ padding: 8 }}>
                                            <Ionicons name="chevron-forward" size={24} color="#FF6B6B" />
                                        </View>
                                    </ScalePress>
                                </View>

                                {isPickerMode ? (
                                    <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 8 }}>
                                        <Text style={{ fontSize: 12, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, marginLeft: 8 }}>Quick Skip</Text>

                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
                                            {years.map(y => (
                                                <ScalePress
                                                    key={y}
                                                    onPress={() => selectYearMonth(y)}
                                                    style={{
                                                        paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16,
                                                        backgroundColor: y === calViewDate.getFullYear() ? '#FF6B6B' : '#F8F8FA',
                                                        borderWidth: 1, borderColor: y === calViewDate.getFullYear() ? '#FF6B6B' : '#EDEDED'
                                                    }}
                                                >
                                                    <Text style={{ color: y === calViewDate.getFullYear() ? '#fff' : '#1C1C1E', fontWeight: '700' }}>{y}</Text>
                                                </ScalePress>
                                            ))}
                                        </ScrollView>

                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                                            {months.map((m, i) => (
                                                <ScalePress
                                                    key={m}
                                                    onPress={() => selectYearMonth(calViewDate.getFullYear(), i)}
                                                    style={{
                                                        width: (W - 74) / 3, paddingVertical: 16, alignItems: 'center', borderRadius: 16,
                                                        backgroundColor: i === calViewDate.getMonth() ? '#FF6B6B' : '#F8F8FA',
                                                        borderWidth: 1, borderColor: i === calViewDate.getMonth() ? '#FF6B6B' : '#EDEDED'
                                                    }}
                                                >
                                                    <Text style={{ color: i === calViewDate.getMonth() ? '#fff' : '#1C1C1E', fontWeight: '600' }}>{m}</Text>
                                                </ScalePress>
                                            ))}
                                        </View>
                                    </Animated.View>
                                ) : (
                                    <>
                                        {/* 4. Grid */}
                                        <View style={{ marginBottom: 24, paddingHorizontal: 8 }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                                                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                                                    <Text key={i} style={{ fontFamily: 'System', fontSize: 12, color: '#A1A1AA', width: 36, textAlign: 'center' }}>{day}</Text>
                                                ))}
                                            </View>
                                            <View style={{ gap: 8 }}>
                                                {(() => {
                                                    const year = calViewDate.getFullYear();
                                                    const month = calViewDate.getMonth();
                                                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                                                    const firstDayOfWeek = new Date(year, month, 1).getDay();

                                                    const rows = [];
                                                    let r = 0;
                                                    while (r * 7 - firstDayOfWeek < daysInMonth) {
                                                        const rowCells = [];
                                                        for (let c = 0; c < 7; c++) {
                                                            const num = r * 7 + c - firstDayOfWeek + 1;
                                                            const isValid = num > 0 && num <= daysInMonth;
                                                            const isSelected = num === calSelectedDay;
                                                            const hasDot = isValid && calMonthStats.distinctDays.has(num);
                                                            const dotColor = hasDot ? (num % 5 === 0 ? '#FF6B6B' : (num % 3 === 0 ? '#FF8E53' : '#FFB3B3')) : 'transparent';

                                                            rowCells.push(
                                                                <Pressable
                                                                    key={c}
                                                                    style={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18, backgroundColor: isSelected ? '#FF6B6B' : 'transparent' }}
                                                                    onPress={() => {
                                                                        if (isValid) {
                                                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                                            setCalScope('day');
                                                                            setCalSelectedDay(num);
                                                                        }
                                                                    }}
                                                                >
                                                                    <Text style={{ fontFamily: 'System', fontSize: 16, fontWeight: isSelected ? '700' : '400', color: isSelected ? '#fff' : (isValid ? '#1C1C1E' : 'transparent') }}>{isValid ? num : ''}</Text>
                                                                    {hasDot && !isSelected && <View style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor }} />}
                                                                </Pressable>
                                                            );
                                                        }
                                                        rows.push(<View key={r} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{rowCells}</View>);
                                                        r++;
                                                    }
                                                    return rows;
                                                })()}
                                            </View>
                                        </View>

                                        {/* 5. Legend */}
                                        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 36 }}>
                                            <Text style={{ fontFamily: 'System', fontSize: 12, color: '#A1A1AA' }}>Photos:</Text>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFB3B3', marginHorizontal: 2 }} />
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF8E53', marginHorizontal: 2 }} />
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF6B6B', marginHorizontal: 2 }} />
                                        </View>
                                    </>
                                )}

                                {/* 6. High-Intent Global CTA */}
                                <ScalePress style={[s.globalJumpBtn, calScope === 'day' && !calSelectedDay && { opacity: 0.5 }]} onPress={() => {
                                    if (calScope === 'day' && !calSelectedDay) return;

                                    // Allow jump as long as they have swipes left
                                    if (!isPro && !canSwipe('photo')) {
                                        setShowCalendar(false);
                                        setTimeout(() => {
                                            setPaywallReason('limit');
                                            setPaywallVisible(true);
                                        }, 300);
                                        return;
                                    }

                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    const filter = {
                                        year: calViewDate.getFullYear(),
                                        month: calScope === 'year' ? undefined : calViewDate.getMonth(),
                                        day: calScope === 'day' ? calSelectedDay! : undefined,
                                        mediaType: calMediaType,
                                    };
                                    activeCatRef.current = 'By Date';
                                    setDateFilter(filter);
                                    setShowCalendar(false);
                                    setShowIntro(false); // CRITICAL: Ensure we transition to the swiping screen
                                    setTimeout(() => {
                                        startSwipingSession('By Date', filter);
                                    }, 300);
                                }}>
                                    <LinearGradient colors={['#ff6b6b', '#ff8e53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.globalJumpGrad}>
                                        <Text style={s.globalJumpTxt}>
                                            Review {calScope === 'year' ? calViewDate.getFullYear()
                                                : `${calViewDate.toLocaleString('default', { month: 'short' })}${calScope === 'day' ? ` ${calSelectedDay}` : ''} ${calViewDate.getFullYear()}`} →
                                        </Text>
                                    </LinearGradient>
                                </ScalePress>
                            </ScrollView>
                        </Animated.View>
                    </GestureDetector>
                </Pressable>
            </Modal>

            {/* Full Image Preview Modal */}
            <Modal
                visible={showFullPreview}
                transparent
                animationType="fade"
                onRequestClose={() => setShowFullPreview(false)}
            >
                <Pressable style={s.fullPreviewOverlay} onPress={() => setShowFullPreview(false)}>
                    <Animated.View entering={FadeInDown.duration(400).springify()} style={s.fullPreviewContent}>
                        {currentPhoto?.mediaType === 'video' ? (
                            <VideoView
                                player={fullPlayer}
                                style={s.fullPreviewImage}
                                contentFit="contain"
                            />
                        ) : (
                            <Image
                                source={{ uri: currentPhoto?.url }}
                                style={s.fullPreviewImage}
                                contentFit="contain"
                                transition={200}
                            />
                        )}
                        <View style={s.fullPreviewHeader}>
                            <ScalePress style={s.fullPreviewClose} onPress={() => setShowFullPreview(false)}>
                                <Ionicons name="close-circle" size={44} color="#fff" />
                            </ScalePress>
                        </View>
                        <View style={s.fullPreviewFooter}>
                            <Text style={s.fullPreviewTitle}>Moment Preview</Text>
                            <Text style={s.fullPreviewSub}>Curating your story, one memory at a time</Text>
                        </View>
                    </Animated.View>
                </Pressable>
            </Modal>

            <Paywall
                visible={paywallVisible}
                onClose={() => setPaywallVisible(false)}
                reason={paywallReason}
            />

            <SettingsModal
                visible={isSettingsVisible}
                onClose={() => setIsSettingsVisible(false)}
                isPro={isPro}
                onUpgrade={() => {
                    setPaywallReason('upgrade');
                    setPaywallVisible(true);
                }}
                onSignOut={handleSignOut}
                onDeleteAccount={handleDeleteAccount}
                totalClearedBytes={totalClearedBytes}
                totalDeletedPhotos={totalDeletedPhotos}
                fmt={fmt}
                onResetSwipes={async () => {
                    await resetDailyLimits();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Debug Success', 'Daily swipes restored. 🛠️');
                }}
            />
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FAFAFA' },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },

    introScrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
    newHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 10 },
    newHeaderIconBg: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#F1F1F1' },

    homeHero: { marginTop: 0, marginBottom: 12 },
    homeHeroTitle: { fontFamily: 'System', fontSize: 34, fontWeight: '800', color: '#1C1C1E', letterSpacing: -1, lineHeight: 40 },
    homeHeroSub: { fontFamily: 'System', fontSize: 17, color: '#6B7280', marginTop: 8, fontWeight: '500' },

    impactCard: { borderRadius: 24, marginBottom: 32, overflow: 'hidden', shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8 },
    impactContent: { padding: 20 },
    impactHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    impactLabel: { fontFamily: 'System', color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
    impactStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    impactStatItem: { flex: 1, alignItems: 'center' },
    impactVal: { fontFamily: 'System', color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
    impactUnit: { fontSize: 12, fontWeight: '600' },
    impactSub: { fontFamily: 'System', color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', marginTop: 2 },
    impactDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.2)' },

    mainCta: { width: '100%', height: 64, borderRadius: 32, backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center', shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 6, marginBottom: 12 },
    mainCtaText: { fontFamily: 'System', color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },

    catGrid: { flexDirection: 'row', gap: 16 },
    catCol: { flex: 1, gap: 16 },
    homeCatCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: '#F1F1F1' },
    catIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    homeCatTitle: { fontFamily: 'System', color: '#1C1C1E', fontSize: 18, fontWeight: '700', marginBottom: 4, letterSpacing: -0.2 },
    homeCatSub: { fontFamily: 'System', color: '#6B7280', fontSize: 13, lineHeight: 16 },

    homeAd: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderColor: '#F1F1F1', alignItems: 'center', paddingBottom: Platform.OS === 'ios' ? 24 : 12 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 30 },
    rollCard: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 32, padding: 32, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.2, shadowRadius: 30, elevation: 15 },
    rollEmoji: { fontSize: 48, marginBottom: 16 },
    rollTitle: { fontFamily: 'System', fontSize: 24, fontWeight: '800', color: '#1C1C1E', marginBottom: 12 },
    rollSub: { fontFamily: 'System', fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    rollBtn: { width: '100%', height: 56, borderRadius: 28, backgroundColor: '#FF6B6B', alignItems: 'center', justifyContent: 'center' },
    rollBtnText: { fontFamily: 'System', color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 20, paddingBottom: 10, zIndex: 10,
    },
    filterPill: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
        shadowColor: 'rgba(0,0,0,0.04)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2,
        borderWidth: 1, borderColor: '#F1F1F1',
    },
    pillCount: { fontFamily: 'System', color: '#FF6B6B', fontSize: 13, fontWeight: '700', marginLeft: 4 },
    pillTotal: { fontFamily: 'System', color: '#1C1C1E', fontSize: 13, fontWeight: '700', marginLeft: 4 },
    pillSeparator: { width: 1, height: 14, backgroundColor: '#F1F1F1', marginHorizontal: 10 },

    cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 180 },
    cardContainerWrapper: { width: W * 0.96, height: H * 0.66, position: 'relative' },
    cardContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 1 },

    emptyState: { flex: 1, width: W, paddingHorizontal: 32, paddingTop: 40, paddingBottom: 60, justifyContent: 'space-between' },
    emptyContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center', marginBottom: 28, borderWidth: 1, borderColor: '#FFE4E4', shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
    emptyTitle: { fontFamily: 'System', fontSize: 32, fontWeight: '800', color: '#1C1C1E', marginBottom: 12, textAlign: 'center', letterSpacing: -0.5 },
    emptySub: { fontFamily: 'System', fontSize: 17, color: '#6B7280', textAlign: 'center', lineHeight: 24, paddingHorizontal: 10 },
    emptyActions: { width: '100%', gap: 16, marginTop: 'auto' },
    dashboardBtn: { width: '100%', height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 6, overflow: 'hidden' },
    dashboardBtnTxt: { fontFamily: 'System', color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
    calendarBtn: { width: '100%', height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1.5, borderColor: '#F1F1F1', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
    calendarBtnTxt: { fontFamily: 'System', color: '#FF6B6B', fontSize: 17, fontWeight: '600' },

    sortSheet: {
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32,
        padding: 24, paddingBottom: 40, width: '100%',
        shadowColor: '#000', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 20,
        borderTopWidth: 1, borderColor: '#F1F1F1'
    },
    sortHandle: { width: 40, height: 5, backgroundColor: '#F1F1F1', borderRadius: 3, alignSelf: 'center', marginBottom: 20 },
    sortTitle: { fontFamily: 'System', fontSize: 20, fontWeight: '700', color: '#1C1C1E', marginBottom: 24, textAlign: 'center' },
    sortOpt: {
        flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 20,
        marginBottom: 12, borderWidth: 1.5, borderColor: '#F8F8FA', backgroundColor: '#F8F8FA'
    },
    sortIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
    sortOptTxt: { fontFamily: 'System', fontSize: 17, color: '#1C1C1E', fontWeight: '500' },

    // Previously referenced but undefined tutorial/celebration styles.
    ghostHandLabels: { position: 'absolute', top: '18%', left: 0, right: 0, alignItems: 'center' },
    ghostLabel: { position: 'absolute', alignItems: 'center' },
    ghostLabelPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12 },
    ghostLabelTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
    tutArrowContainer: { position: 'absolute', bottom: 180, right: 48, alignItems: 'center' },
    tutArrow: { fontSize: 64, color: '#fff', fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 8 },

    celebOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    celebCard: {
        width: '100%', maxWidth: 440, backgroundColor: '#fff', borderRadius: 32,
        paddingHorizontal: 28, paddingTop: 30, paddingBottom: 24, alignItems: 'center',
        overflow: 'hidden', borderWidth: 1, borderColor: '#FFE4E4',
        shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 12,
    },
    celebShimmer: { position: 'absolute', top: 0, left: 24, right: 24, height: 1, backgroundColor: '#FFE4E4' },
    celebIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    celebEmoji: { fontSize: 40 },
    orbitContainer: { position: 'absolute', width: 96, height: 96, alignItems: 'center', justifyContent: 'flex-start' },
    orbitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF6B6B' },
    celebTitle: { fontSize: 22, fontWeight: '700', color: '#1C1C1E', textAlign: 'center', marginBottom: 16 },
    celebStorage: { alignItems: 'center', marginBottom: 20 },
    celebStorageVal: { fontSize: 38, fontWeight: '700', color: '#FF6B6B' },
    celebStorageUnit: { fontSize: 20 },
    celebStorageLbl: { fontSize: 12, color: '#6B7280', marginTop: 4, textAlign: 'center' },
    celebStatsCol: { width: '100%', gap: 10, marginBottom: 20 },
    celebStatRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, padding: 12, gap: 12 },
    celebStatIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    celebStatNum: { fontSize: 20, fontWeight: '700' },
    celebStatLabel: { flex: 1, fontSize: 14, color: '#4B5563' },
    progressWrap: { width: '100%', marginBottom: 20 },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    progressLbl: { fontSize: 12, color: '#6B7280' },
    progressNum: { fontSize: 12, fontWeight: '600', color: '#1C1C1E' },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#F1F1F1', overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: '#FF6B6B', borderRadius: 3 },
    celebPrimaryBtn: { width: '100%', borderRadius: 28, overflow: 'hidden', marginBottom: 12 },
    celebPrimaryGrad: { paddingVertical: 16, alignItems: 'center' },
    celebPrimaryTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
    celebSecBtn: { padding: 10 },
    celebSecTxt: { color: '#FF6B6B', fontSize: 15, fontWeight: '600' },

    ghostHandContainer: { position: 'absolute', width: '100%', height: '100%', zIndex: 1000, elevation: 20, alignItems: 'center', justifyContent: 'center' },
    ghostHandCircle: {
        width: 70, height: 70, borderRadius: 35,
        backgroundColor: 'rgba(255,107,107,0.95)',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: 'rgba(255,107,107,0.5)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 8,
        marginTop: 60
    },

    settingsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    settingsContent: {
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32,
        paddingHorizontal: 24, paddingTop: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 15,
    },
    settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    settingsTitle: { fontFamily: 'System', color: '#1C1C1E', fontSize: 24, fontWeight: '700' },
    settingsClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8F8FA', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F1F1F1' },
    settingsList: { gap: 12 },
    settingsOption: {
        flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20,
        backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1F1F1'
    },
    settingsIconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#F8F8FA', alignItems: 'center', justifyContent: 'center', marginRight: 16, borderWidth: 1, borderColor: '#F1F1F1' },
    settingsOptionTxt: { flex: 1, fontFamily: 'System', color: '#1C1C1E', fontSize: 17, fontWeight: '500' },
    settingsStatsBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F8FA', borderRadius: 20, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#F1F1F1' },
    settingsStatItem: { flex: 1, alignItems: 'center' },
    settingsStatVal: { fontFamily: 'System', color: '#1C1C1E', fontSize: 18, fontWeight: '800' },
    settingsStatLbl: { fontFamily: 'System', color: '#A1A1AA', fontSize: 11, fontWeight: '600', marginTop: 2, textTransform: 'uppercase' },
    settingsDivider: { height: 1, backgroundColor: '#F1F1F1', marginVertical: 8 },
    versionTxt: { fontFamily: 'System', color: '#A1A1AA', fontSize: 13, textAlign: 'center', marginTop: 24 },

    fullPreviewOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    fullPreviewContent: {
        width: W * 0.9, height: H * 0.75, borderRadius: 32, overflow: 'hidden',
        backgroundColor: '#111', shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.5, shadowRadius: 40, elevation: 25,
    },
    fullPreviewImage: { width: '100%', height: '100%' },
    fullPreviewHeader: { position: 'absolute', top: 20, right: 20, zIndex: 100 },
    fullPreviewClose: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    fullPreviewFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 30, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center' },
    fullPreviewTitle: { fontFamily: 'System', color: '#fff', fontSize: 24, marginBottom: 4, fontWeight: '700' },
    fullPreviewSub: { fontFamily: 'System', color: 'rgba(255,255,255,0.7)', fontSize: 14 },

    tutBinOverlay: {
        width: '85%', alignSelf: 'center', backgroundColor: '#1f2937', borderRadius: 32, paddingHorizontal: 28,
        paddingTop: 36, paddingBottom: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 24 },
        shadowOpacity: 0.6, shadowRadius: 32, elevation: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
    },
    tutIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(52,199,89,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    tutBinTitle: { fontFamily: 'System', color: '#fff', fontSize: 26, marginBottom: 12, textAlign: 'center' },
    tutBinDesc: { fontFamily: 'System', color: '#d1d5db', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    tutBinDesc2: { fontFamily: 'System', color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 28 },
    tutBinBtn: { width: '100%', backgroundColor: '#fff', paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
    tutBinBtnText: { fontFamily: 'System', color: '#1f2937', fontSize: 18 },

    calTutCard: {
        width: '94%', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 28,
        paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, alignItems: 'center',
        borderWidth: 1, borderColor: '#F1F1F1',
        shadowColor: 'rgba(0,0,0,0.02)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2,
    },
    calTutIconWrap: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center', marginBottom: 18, borderWidth: 1, borderColor: '#F1F1F1' },
    calTutTitle: { fontFamily: 'System', color: '#1C1C1E', fontSize: 24, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
    calTutDesc: { fontFamily: 'System', color: '#6B7280', fontSize: 16, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    calTutBtn: { width: '80%', backgroundColor: '#FF6B6B', paddingVertical: 14, borderRadius: 100, alignItems: 'center' },
    calTutBtnText: { fontFamily: 'System', color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

    globalJumpBtn: { width: '100%', borderRadius: 16, overflow: 'hidden', marginTop: 24, shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
    globalJumpGrad: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
    globalJumpTxt: { fontFamily: 'System', color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

    headerIconBg: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#F1F1F1' },
    headerPillContainer: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    swipePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF1F1', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#FFE4E4', gap: 6 },
    swipePillTxt: { fontFamily: 'System', color: '#FF6B6B', fontSize: 13, fontWeight: '800' },
    statsPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#F1F1F1', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
    statsPillTxt: { fontFamily: 'System', color: '#1C1C1E', fontSize: 13, fontWeight: '800' },
    pillDivider: { width: 1, height: 12, backgroundColor: '#F1F1F1', marginHorizontal: 2 },

    actions: {
        position: 'absolute', left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 16, paddingHorizontal: 20, zIndex: 100
    },
    mainBtn: {
        width: 62, height: 62, borderRadius: 31,
        backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1, shadowRadius: 10, elevation: 4,
        borderWidth: 1, borderColor: '#F1F1F1'
    },
    smallBtn: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
        borderWidth: 1, borderColor: '#F1F1F1'
    },
});

