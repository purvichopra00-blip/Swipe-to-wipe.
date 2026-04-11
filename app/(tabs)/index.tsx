import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    StyleSheet, Text, View, Dimensions, Pressable,
    Modal, Animated as RNAnimated, StatusBar, Platform, TextInput, Alert, Share,
    ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
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
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import { usePhotos } from '../../contexts/PhotoContext';
import { SortMode } from '../../contexts/PhotoContext';
import SwipeCard from '../../components/SwipeCard';
import { AppBannerAd, BannerAdSize, AdUnits, createSafeInterstitial, AdEventType } from '../../lib/ads';
import { AD_CONFIG } from '../../constants/Ads';

const { width: W, height: H } = Dimensions.get('window');
const SWIPE_THRESHOLD = W * 0.28;
const VISIBLE_CARDS = 3;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

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

/* ΓöÇΓöÇΓöÇ Animated counting number (Standard Text for best layout) ΓöÇΓöÇΓöÇ */
function CountUp({ to, duration = 1500, style, delay = 0 }: { to: number; duration?: number; style?: any; delay?: number }) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let startTime: number;
        let animationFrame: number;

        const animate = (time: number) => {
            if (!startTime) startTime = time;
            const progress = (time - startTime - delay) / duration;

            if (progress < 0) {
                animationFrame = requestAnimationFrame(animate);
                return;
            }

            if (progress >= 1) {
                setCount(to);
                return;
            }

            setCount(Math.floor(to * progress));
            animationFrame = requestAnimationFrame(animate);
        };

        animationFrame = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationFrame);
    }, [to, delay, duration]);

    return (
        <Text
            style={style}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
        >
            {count.toLocaleString()}
        </Text>
    );
}

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
        isLoadingSession, startSwipingSession, loadCategoryStats,
        sortMode, setSortMode, endSession, permissionsGranted,
        categoryCounts, totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        showIntro, setShowIntro
    } = usePhotos();

    const insets = useSafeAreaInsets();
    const router = useRouter();
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const soundRef = useRef<Audio.Sound | null>(null);
    const [showSort, setShowSort] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [isCalculatingInfo, setIsCalculatingInfo] = useState(false);
    const [detailedInfo, setDetailedInfo] = useState<{ size: number; width: number; height: number }>({ size: 0, width: 0, height: 0 });
    const [isSharing, setIsSharing] = useState(false);
    const sortProgress = useSharedValue(0);
    const activeCatRef = useRef<string>('Random');

    const [showCelebration, setShowCelebration] = useState(false);
    const [lastCelebrationCount, setLastCelebrationCount] = useState(0);
    const [lastSwipedId, setLastSwipedId] = useState<string | null>(null);
    const [adTriggerCounter, setAdTriggerCounter] = useState(0);
    const [interstitial, setInterstitial] = useState<any>(null);
    const [adLoaded, setAdLoaded] = useState(false);

    const [showFullPreview, setShowFullPreview] = useState(false);

    useEffect(() => {
        const ad = createSafeInterstitial(AdUnits.INTERSTITIAL);
        if (ad) {
            const unsubscribeLoaded = ad.addAdEventListener(AdEventType.LOADED, () => setAdLoaded(true));
            const unsubscribeError = ad.addAdEventListener(AdEventType.ERROR, (err: any) => {
                console.warn('Interstitial Load Error:', err);
                setAdLoaded(false);
                // In production, AdMob might return 0 fill initially. Ensure we retry.
                setTimeout(() => { ad.load(); }, 15000);
            });
            const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
                setAdLoaded(false);
                setAdTriggerCounter(0);
                ad.load();
            });
            ad.load();
            setInterstitial(ad);
            return () => {
                unsubscribeLoaded();
                unsubscribeError();
                unsubscribeClosed();
            };
        }
    }, []);

    const showAd = useCallback(() => {
        if (adLoaded && interstitial) {
            interstitial.show();
        } else {
            // If ad wasn't loaded by the time we hit the trigger, try loading it again.
            if (interstitial && !adLoaded) {
                interstitial.load();
            }
            setAdTriggerCounter(0); // Reset if ad failed
        }
    }, [adLoaded, interstitial]);
    const celebScale = useRef(new RNAnimated.Value(0.8)).current;
    const celebOpacity = useRef(new RNAnimated.Value(0)).current;
    const orbitSpin = useRef(new RNAnimated.Value(0)).current;
    const [storage, setStorage] = useState<{ used: number; total: number } | null>(null);
    const hasInitialAutoStarted = useRef(false);

    // Image Pre-loading: Fetch next 3 images to prevent flicker during fast swiping
    useEffect(() => {
        if (photos && photos.length > 0) {
            const nextPhotos = photos.slice(currentIndex, currentIndex + 4);
            nextPhotos.forEach(p => {
                if (p.url) Image.prefetch(p.url);
            });
        }
    }, [currentIndex, photos]);

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
        startSwipingSession(category);
        setShowIntro(false);
    };

    // Auto transition from initial welcome splash to swiping session after 3 seconds
    useEffect(() => {
        if (showIntro) {
            const timer = setTimeout(() => {
                enterSession('Random');
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [showIntro]);

    const fmt = (b: number) => b > 1024 ** 2 * 900 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

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
        RNAnimated.loop(
            RNAnimated.timing(orbitSpin, {
                toValue: 1, duration: 4000, easing: Easing.linear as any, useNativeDriver: true
            })
        ).start();
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
        endSession();
    }, [endSession]);

    const openSort = () => {
        setShowSort(true);
        sortProgress.value = withSpring(1, { damping: 15, stiffness: 150 });
    };
    const openInfo = useCallback(async () => {
        if (!currentPhoto) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setShowInfo(true);
        setIsCalculatingInfo(true);

        // Use the metadata ALREADY present in the photo object 
        // to avoid buggy and crashing MediaLibrary calls.
        setDetailedInfo({
            size: currentPhoto.fileSize || 0,
            width: currentPhoto.width || 0,
            height: currentPhoto.height || 0
        });

        try {
            // Optional: only fetch high-precision info if it's missing (rare)
            if (!currentPhoto.fileSize) {
                const info = await MediaLibrary.getAssetInfoAsync(currentPhoto.id, { shouldDownloadFromNetwork: false });
                const newSize = (info as any).fileSize || (info as any).size || 0;
                setDetailedInfo(prev => ({
                    ...prev,
                    size: newSize || prev.size,
                    width: info.width || prev.width,
                    height: info.height || prev.height
                }));
            }
        } catch (error) {
            console.warn("Non-critical info fetch failed:", error);
        } finally {
            setIsCalculatingInfo(false);
        }
    }, [currentPhoto]);
    const closeSort = () => {
        sortProgress.value = withTiming(0, { duration: 250 }, () => runOnJS(setShowSort)(false));
    };
    const selectSort = useCallback(async (mode: SortMode) => {
        setSortMode(mode);
        closeSort();
        await startSwipingSession(activeCatRef.current);
    }, [setSortMode, startSwipingSession]);

    // Swipe Tutorial Logic (Progressive Disclosure)
    const TUTORIAL_SEEN_KEY = '@swipe_tutorial_v10';
    const [tutorialStepState, _setTutorialStep] = useState<0 | 1 | 2 | 3>(0);
    const tutorialStepRef = useRef<0 | 1 | 2 | 3>(0);
    const isTutorialActive = useSharedValue(false);
    const handOpacity = useSharedValue(0);
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
        if (tutorialStepRef.current === 1) {
            setTutorialStep(2); // Ghost hands disappear, wait quietly for left swipe
            AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '2');
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        translateX.value = 0; // Reset FIRST to prevent new card from appearing off-screen
        translateY.value = 0;
        swipeRight();
        setAdTriggerCounter(prev => {
            const next = prev + 1;
            if (next >= AD_CONFIG.SWIPES_PER_INTERSTITIAL) {
                showAd();
            }
            return next;
        });
    }, [swipeRight, translateX, showAd]);

    const handleSwipeLeft = useCallback(() => {
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
        swipeLeft();
        setAdTriggerCounter(prev => {
            const next = prev + 1;
            if (next >= AD_CONFIG.SWIPES_PER_INTERSTITIAL) {
                showAd();
            }
            return next;
        });
    }, [swipeLeft, translateX, playDeleteSound, showAd]);

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
                    damping: 18, stiffness: 180, mass: 0.8, velocity: e.velocityX
                });
                translateY.value = withSpring(0, {
                    damping: 18, stiffness: 180, mass: 0.8, velocity: e.velocityY
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
                    totalVisible={VISIBLE_CARDS} translateX={translateX} translateY={translateY} isTop={i === 0} />
            );
        }
        return cards;
    };

    const sortLabel = sortMode === 'newest' ? 'Newest' : sortMode === 'oldest' ? 'Oldest' : 'Largest';

    /* ΓöÇΓöÇ INTRO SCREEN (early return) ΓöÇΓöÇ */
    if (showIntro) {
        return (
            <View style={s.container}>
                <StatusBar barStyle="dark-content" />
                <LinearGradient colors={['#fff0f5', '#ffffff', '#fef1f6']} style={StyleSheet.absoluteFill} />
                <View style={s.introOverlay}>
                    <FadeSlideIn delay={100}>
                        <Text style={s.introGreeting}>{getGreeting() + ' \uD83D\uDC4B'}</Text>
                        <Text style={s.introSub}>Here's your gallery at a glance</Text>
                    </FadeSlideIn>
                    <View style={s.introStatsRow}>
                        <View style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                                <Ionicons name="image" size={24} color="#6366f1" />
                            </View>
                            <CountUp to={categoryCounts.photos} delay={400} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Photos</Text>
                        </View>
                        <View style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(236,72,153,0.12)' }]}>
                                <Ionicons name="videocam" size={24} color="#ec4899" />
                            </View>
                            <CountUp to={categoryCounts.videos} delay={600} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Videos</Text>
                        </View>
                        <View style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
                                <Ionicons name="phone-portrait" size={24} color="#22c55e" />
                            </View>
                            <CountUp to={categoryCounts.screenshots} delay={800} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Screenshots</Text>
                        </View>
                    </View>
                    {storage && (
                        <FadeSlideIn delay={900} style={s.introStorageWrap}>
                            <Text style={s.introStorageTxt}>{fmt(storage.used)} of {fmt(storage.total)} used</Text>
                            <View style={s.introStorageTrack}>
                                <View style={[s.introStorageFill, { width: `${Math.min(100, (storage.used / storage.total) * 100)}%` }]} />
                            </View>
                        </FadeSlideIn>
                    )}
                    <FadeSlideIn delay={1100}>
                        <Text style={s.introReady}>
                            {totalClearedBytes > 0
                                ? `You've already freed up ${(totalClearedBytes / (1024 * 1024)).toFixed(1)} MB! \u2728`
                                : "Let's free up some space! \u2728"}
                        </Text>
                    </FadeSlideIn>
                </View>
            </View>
        );
    }

    /* ΓöÇΓöÇ MAIN SWIPE SCREEN ΓöÇΓöÇ */
    return (
        <View style={s.container}>
            <StatusBar barStyle="dark-content" />
            <LinearGradient colors={['#fff0f5', '#ffffff', '#fff0f5']} style={StyleSheet.absoluteFill} />

            {/* Header */}
            <View style={[s.header, { paddingTop: Math.max(insets.top, 12), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ScalePress
                        style={{ padding: 4, marginRight: 4 }}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            setShowIntro(true);
                        }}
                    >
                        <Ionicons name="home-outline" size={20} color="#6366f1" />
                    </ScalePress>
                    {/* Failsafe Hidden Tutorial Button on the Title string */}
                    <ScalePress onPress={() => setTutorialStep(1)}>
                        <Text style={s.title}>
                            Swipe to <Text style={s.titleBold}>Wipe</Text>
                        </Text>
                    </ScalePress>
                    <ScalePress
                        style={{ padding: 4, marginLeft: 2 }}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            startSwipingSession(activeCatRef.current);
                        }}
                    >
                        <Ionicons name="refresh" size={18} color="#9ca3af" />
                    </ScalePress>
                </View>

                <View style={s.filterPill}>
                    <Ionicons name="heart" size={12} color="#22c55e" style={{ marginRight: 4 }} />
                    <Text style={s.pillCount}>{totalKeptPhotos}</Text>
                    <View style={s.pillSeparator} />
                    <Ionicons name="close" size={16} color="#ef4444" style={{ marginRight: 4 }} />
                    <Text style={s.pillTotal}>{totalBinnedPhotos}</Text>
                </View>
            </View>

            {/* Cards Area */}
            <View style={s.cardArea}>
                {isLoadingSession ? (
                    <View style={s.emptyState}>
                        <ActivityIndicator size="large" color="#ff6b6b" />
                        <Text style={[s.emptySub, { marginTop: 20 }]}>Gathering your media...</Text>
                    </View>
                ) : currentPhoto ? (
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
                                        <View style={[s.ghostLabelPill, { backgroundColor: '#22c55e' }]}>
                                            <Ionicons name="heart" size={14} color="#fff" />
                                            <Text style={s.ghostLabelTxt}>Swipe Right to Keep</Text>
                                        </View>
                                    </Animated.View>
                                    <Animated.View style={[s.ghostLabel, { opacity: interpolate(translateX.value, [0, -SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) }]}>
                                        <View style={[s.ghostLabelPill, { backgroundColor: '#ef4444' }]}>
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
                ) : (
                    <View style={s.emptyState}>
                        <Text style={s.emptyEmoji}>{'\uD83C\uDF89'}</Text>
                        <Text style={s.emptyTitle}>All Done!</Text>
                        <Text style={s.emptySub}>Check the Review Bin to clean up.</Text>
                        <Pressable style={s.goBackBtn} onPress={handleBack}>
                            <LinearGradient colors={['#ff6b6b', '#ff8e53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.goBackGrad}>
                                <Text style={s.goBackTxt}>Go Back</Text>
                            </LinearGradient>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* Step 3 (was 2) Tutorial Overlay (The Bin Pointer) */}
            {tutorialStepState === 3 && (
                <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999, justifyContent: 'center' }]} pointerEvents="box-none">
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]} />
                    
                    <Animated.View entering={FadeInDown.duration(600).delay(300).springify()} style={s.tutBinOverlay}>
                        <View style={s.tutIconWrap}>
                            <Ionicons name="shield-checkmark" size={44} color="#34C759" />
                        </View>
                        <Text style={s.tutBinTitle}>Safe in the Bin! 🛡️</Text>
                        <Text style={s.tutBinDesc}>
                            Don't panic! Trashed photos are never deleted instantly. They wait safely in your <Text style={{fontWeight: '800', color: '#fff'}}>Review Bin</Text> first.
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

            {/* Action Bar */}
            {currentPhoto && (
                <View style={[s.actions, { paddingBottom: Math.max(insets.bottom, 20) + 144 }]}>
                    <ScalePress
                        style={[s.smallBtn, !canUndo && { opacity: 0.3 }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); undo(); }}
                        disabled={!canUndo}
                    >
                        <Ionicons name="arrow-undo" size={24} color="#fca5a5" />
                    </ScalePress>
                    <ScalePress
                        style={[s.mainBtn, s.deleteBtn]}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            playDeleteSound();
                            translateX.value = withSpring(-W * 1.5, { velocity: -500, stiffness: 200, damping: 20 }, () => runOnJS(handleSwipeLeft)());
                        }}
                    >
                        <Ionicons name="close" size={40} color="#ef4444" />
                    </ScalePress>
                    <ScalePress
                        style={[s.smallBtn]}
                        disabled={isSharing}
                        onPress={async () => {
                            if (!currentPhoto || isSharing) return;
                            setIsSharing(true);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            try {
                                if (await Sharing.isAvailableAsync()) {
                                    // Robust sharing: Resolve to a physical file URI
                                    const assetInfo = await MediaLibrary.getAssetInfoAsync(currentPhoto.id, { shouldDownloadFromNetwork: true });
                                    let shareUri = assetInfo.localUri || assetInfo.uri;

                                    if (!shareUri) {
                                        Alert.alert('Download Failed', 'Could not fetch this photo from iCloud. Please check your internet connection.');
                                        return;
                                    }

                                    const isVideo = currentPhoto.mediaType === 'video';

                                    // WhatsApp rejects HEIC & iCloud ph:// links.
                                    // Use ImageManipulator to convert ph:// (or even local HEIC) to a shiny new file:// JPEG.
                                    if (Platform.OS === 'ios' && currentPhoto.mediaType === 'photo') {
                                        try {
                                            const manip = await ImageManipulator.manipulateAsync(
                                                shareUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                                            );
                                            shareUri = manip.uri; // This is a guaranteed file:// JPEG!
                                        } catch (err) {
                                            console.warn('ImageManipulator failed during sharing', err);
                                        }
                                    }

                                    // Fallback for Videos or if ImageManipulator failed:
                                    if (Platform.OS === 'ios' && !shareUri.startsWith('file://')) {
                                        const ext = currentPhoto.filename?.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
                                        const baseDir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory;
                                        if (!baseDir) {
                                            Alert.alert('Error', 'Temporary storage not available.');
                                            return;
                                        }
                                        const tmpDir = baseDir + 'shares/';
                                        await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true }).catch(() => { });
                                        const tmpFile = `${tmpDir}${currentPhoto.id}.${ext}`;
                                        await FileSystem.copyAsync({ from: shareUri, to: tmpFile });
                                        shareUri = tmpFile;
                                    }

                                    if (!shareUri.startsWith('file://')) {
                                        // Still on ph://, WhatsApp will likely fail, but let's try direct shareUri anyway
                                        console.warn('Sharing URI is still virtual:', shareUri);
                                    }

                                    const shareMessage = `Hey, look what I found while cleaning my phone! ✨\n\nGet Swipe to Wipe:\n🍏 iOS: https://apps.apple.com/us/app/swipe-to-wipe/id6761011430\n🤖 Android: https://play.google.com/store/apps/details?id=com.purvichopra.swipetowipe`;

                                    if (Platform.OS === 'ios') {
                                        // WhatsApp on iOS often ignores the message when a file is shared.
                                        // We copy it to the clipboard as a fallback so they can just "Paste".
                                        await Clipboard.setStringAsync(shareMessage);

                                        await Share.share({
                                            url: shareUri,
                                            message: shareMessage,
                                        });

                                        // Subtle hint for WhatsApp users
                                        setTimeout(() => {
                                            Alert.alert(
                                                "Message Copied!",
                                                "WhatsApp sometimes skips the message. We've copied it to your clipboard so you can just 'Paste' it in the chat! \u2728",
                                                [{ text: "Got it!" }]
                                            );
                                        }, 1000);
                                    } else {
                                        // Android: Sharing.shareAsync is better for files.
                                        await Clipboard.setStringAsync(shareMessage);
                                        await Sharing.shareAsync(shareUri, {
                                            dialogTitle: shareMessage,
                                            mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
                                        });
                                        
                                        setTimeout(() => {
                                            Alert.alert(
                                                "Message Copied!",
                                                "Android apps often drop the message when sharing files directly. We've copied the message to your clipboard so you can just 'Paste' it in the chat! \u2728",
                                                [{ text: "Got it!" }]
                                            );
                                        }, 1000);
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
                        <Ionicons name="share-social-outline" size={24} color="#3b82f6" />
                    </ScalePress>
                    <ScalePress
                        style={[s.mainBtn, s.keepBtn]}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            translateX.value = withSpring(W * 1.5, { velocity: 500, stiffness: 200, damping: 20 }, () => runOnJS(handleSwipeRight)());
                        }}
                    >
                        <Ionicons name="heart" size={36} color="#22c55e" />
                    </ScalePress>
                    <ScalePress style={s.smallBtn} onPress={openInfo}>
                        <Ionicons name="information" size={22} color="#fca5a5" />
                    </ScalePress>
                </View>
            )}

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
                                <Text style={s.celebStorageLbl}>Storage Freed</Text>
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
                                    <Ionicons name="trash" size={16} color="#ef4444" />
                                </View>
                                <Text style={[s.celebStatNum, { color: '#ef4444' }]}>{sessionStats.deleted}</Text>
                                <Text style={s.celebStatLabel}>Deleted</Text>
                            </View>
                            <View style={[s.celebStatRow, { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)' }]}>
                                <View style={[s.celebStatIcon, { backgroundColor: 'rgba(34,197,94,0.2)' }]}>
                                    <Ionicons name="heart" size={16} color="#22c55e" />
                                </View>
                                <Text style={[s.celebStatNum, { color: '#22c55e' }]}>{sessionStats.kept}</Text>
                                <Text style={s.celebStatLabel}>Kept</Text>
                            </View>
                        </View>
                        <View style={s.progressWrap}>
                            <View style={s.progressHeader}>
                                <Text style={s.progressLbl}>Session Progress</Text>
                                <Text style={s.progressNum}>{sessionStats.swiped} / {sessionStats.swiped + remainingCount}</Text>
                            </View>
                            <View style={s.progressTrack}>
                                <View style={[s.progressFill, { width: `${Math.min(100, (sessionStats.swiped / (sessionStats.swiped + remainingCount)) * 100)}%` }]} />
                            </View>
                        </View>
                        <Pressable style={({ pressed }) => [s.celebPrimaryBtn, pressed && { transform: [{ scale: 0.96 }] }]} onPress={closeCelebration}>
                            <LinearGradient colors={['#6366f1', '#8b5cf6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.celebPrimaryGrad}>
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
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(99,102,241,0.1)' }]}><Ionicons name="time-outline" size={20} color="#6366f1" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'newest' && { color: '#ff6b6b', fontFamily: 'DMSans_700Bold' }]}>Newest First</Text>
                        </ScalePress>
                        <ScalePress style={[s.sortOpt, sortMode === 'oldest' && { borderColor: '#ff6b6b', backgroundColor: '#fff5f5' }]} onPress={() => { setSortMode('oldest'); closeSort(); }}>
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(236,72,153,0.1)' }]}><Ionicons name="hourglass-outline" size={20} color="#ec4899" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'oldest' && { color: '#ff6b6b', fontFamily: 'DMSans_700Bold' }]}>Oldest First</Text>
                        </ScalePress>
                        <ScalePress style={[s.sortOpt, sortMode === 'largest' && { borderColor: '#ff6b6b', backgroundColor: '#fff5f5' }]} onPress={() => { setSortMode('largest'); closeSort(); }}>
                            <View style={[s.sortIcon, { backgroundColor: 'rgba(34,197,94,0.1)' }]}><Ionicons name="expand-outline" size={20} color="#22c55e" /></View>
                            <Text style={[s.sortOptTxt, sortMode === 'largest' && { color: '#ff6b6b', fontFamily: 'DMSans_700Bold' }]}>Largest First</Text>
                        </ScalePress>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Photo Info Modal */}
            <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
                <Pressable style={s.celebOverlay} onPress={() => setShowInfo(false)}>
                    <View style={[s.celebCard, { paddingTop: 24 }]}>
                        <Text style={s.celebTitle}>Photo Details</Text>
                        {currentPhoto && (
                            <View style={{ width: '100%', gap: 12 }}>
                                <View style={s.celebStatRow}>
                                    <View style={[s.celebStatIcon, { backgroundColor: '#f3f4f6' }]}>
                                        <Ionicons name="document-text" size={18} color="#666" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Filename</Text>
                                        <Text style={{ fontFamily: 'DMSans_700Bold', color: '#1f2937' }} numberOfLines={1}>{currentPhoto.filename || 'Unknown'}</Text>
                                    </View>
                                </View>
                                <View style={s.celebStatRow}>
                                    <View style={[s.celebStatIcon, { backgroundColor: '#f3f4f6' }]}>
                                        <Ionicons name="calendar-sharp" size={18} color="#666" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Date taken</Text>
                                        <Text style={{ fontFamily: 'DMSans_700Bold', color: '#1f2937' }}>
                                            {new Date(currentPhoto.creationTime || Date.now()).toLocaleString()}
                                        </Text>
                                    </View>
                                </View>
                                <View style={s.celebStatRow}>
                                    <View style={[s.celebStatIcon, { backgroundColor: '#f3f4f6' }]}>
                                        <Ionicons name="save" size={18} color="#666" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Size</Text>
                                        <Text style={{ fontFamily: 'DMSans_700Bold', color: '#1f2937' }}>
                                            {isCalculatingInfo ? 'Calculating...' : (detailedInfo?.size ? (detailedInfo.size / (1024 * 1024)).toFixed(1) + ' MB' : 'N/A')}
                                        </Text>
                                    </View>
                                </View>
                                {!!detailedInfo?.width && (
                                    <View style={s.celebStatRow}>
                                        <View style={[s.celebStatIcon, { backgroundColor: '#f3f4f6' }]}>
                                            <Ionicons name="expand-outline" size={18} color="#666" />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Dimensions</Text>
                                            <Text style={{ fontFamily: 'DMSans_700Bold', color: '#1f2937' }}>
                                                {detailedInfo.width} × {detailedInfo.height}
                                            </Text>
                                        </View>
                                    </View>
                                )}
                            </View>
                        )}
                        <Pressable
                            style={({ pressed }) => [s.celebPrimaryBtn, { marginTop: 24 }, pressed && { transform: [{ scale: 0.96 }] }]}
                            onPress={() => setShowInfo(false)}
                        >
                            <LinearGradient colors={['#6366f1', '#8b5cf6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.celebPrimaryGrad}>
                                <Text style={[s.celebPrimaryTxt, { color: '#fff', fontSize: 16, marginBottom: 0 }]}>Got it</Text>
                            </LinearGradient>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>

            {/* Full Preview Modal */}
            <Modal
                visible={showFullPreview}
                transparent
                animationType="fade"
                onRequestClose={() => setShowFullPreview(false)}
            >
                <Pressable
                    style={s.fullPreviewOverlay}
                    onPress={() => setShowFullPreview(false)}
                >
                    <StatusBar barStyle="light-content" />
                    <LinearGradient
                        colors={['rgba(0,0,0,0.92)', 'rgba(0,0,0,0.85)']}
                        style={StyleSheet.absoluteFill}
                    />

                    <Animated.View
                        entering={FadeInDown.duration(400)}
                        style={s.fullPreviewContent}
                    >
                        {currentPhoto && (
                            currentPhoto.mediaType === 'video' ? (
                                <Image
                                    source={currentPhoto.url}
                                    style={s.fullPreviewImage}
                                    contentFit="contain"
                                />
                            ) : (
                                <Image
                                    source={currentPhoto.url}
                                    style={s.fullPreviewImage}
                                    contentFit="contain"
                                />
                            )
                        )}

                        <View style={s.fullPreviewHeader}>
                            <ScalePress
                                style={s.fullPreviewClose}
                                onPress={() => setShowFullPreview(false)}
                            >
                                <Ionicons name="close-circle" size={44} color="#ffffff" />
                            </ScalePress>
                        </View>

                        <View style={s.fullPreviewFooter}>
                            <Text style={s.fullPreviewTitle}>Full Preview</Text>
                            <Text style={s.fullPreviewSub}>Release to return to swiping</Text>
                        </View>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Bottom Banner Ad */}
            <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, 20) + 72, left: 0, right: 0, alignItems: 'center' }}>
                <AppBannerAd
                    unitId={AdUnits.BANNER}
                    size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                    requestOptions={{ requestNonPersonalizedAdsOnly: true }}
                />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 15,
        backgroundColor: 'transparent',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    /* ΓöÇΓöÇ Intro Splash ΓöÇΓöÇ */
    introOverlay: {
        flex: 1,
        justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 28,
    },
    introGreeting: {
        fontFamily: 'DMSans_700Bold', fontSize: 32, color: '#1f2937',
        textAlign: 'center', marginBottom: 4,
    },
    introSub: {
        fontFamily: 'DMSans_500Medium', fontSize: 15, color: '#9ca3af',
        textAlign: 'center', marginBottom: 36,
    },
    introStatsRow: {
        flexDirection: 'row', gap: 10, marginBottom: 28,
    },
    introStatCard: {
        flex: 1, backgroundColor: '#ffffff', borderRadius: 20,
        paddingVertical: 14, paddingHorizontal: 2, alignItems: 'center',
        shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1, shadowRadius: 12, elevation: 4,
        borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)',
    },
    introStatIconWrap: {
        width: 48, height: 48, borderRadius: 24,
        alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    },
    introStatNum: {
        fontFamily: 'DMSans_700Bold', fontSize: 22, color: '#1f2937',
        letterSpacing: -1, marginBottom: 2,
    },
    introStatLabel: {
        fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: 0.5,
    },
    introStorageWrap: {
        width: '100%', backgroundColor: '#ffffff', borderRadius: 16,
        paddingHorizontal: 20, paddingVertical: 14,
        shadowColor: 'rgba(0,0,0,0.04)', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1, shadowRadius: 8, elevation: 2,
        borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)',
        marginBottom: 28,
    },
    introStorageTxt: {
        fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#6b7280', marginBottom: 8,
    },
    introStorageTrack: {
        height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden',
    },
    introStorageFill: {
        height: '100%', borderRadius: 3,
        backgroundColor: '#ff6b6b',
    },
    introReady: {
        fontFamily: 'DMSans_700Bold', fontSize: 18, color: '#ff6b6b',
        textAlign: 'center',
    },

    title: {
        fontSize: 18,
        fontFamily: 'DMSans_400Regular',
        color: '#1f2937',
        letterSpacing: -0.2
    },
    titleBold: {
        fontFamily: 'Syne_800ExtraBold',
        color: '#ff6b6b',
    },
    statBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 5,
        borderWidth: 1.5,
    },
    statBadgeTxt: {
        fontSize: 11,
        fontWeight: '800',
    },
    subtitle: {
        fontSize: 13,
        color: '#9ca3af',
        fontWeight: '600',
        marginTop: 2,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    filterPill: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
        shadowColor: 'rgba(255,107,107,0.12)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3,
        borderWidth: 1.5, borderColor: '#fef2f2',
    },
    filterText: { fontFamily: 'DMSans_700Bold', color: '#6b7280', fontSize: 13 },
    pillCount: { fontFamily: 'Syne_700Bold', color: '#22c55e', fontSize: 13 },
    pillTotal: { fontFamily: 'Syne_700Bold', color: '#ef4444', fontSize: 13 },
    pillSeparator: { width: 1.5, height: 12, backgroundColor: '#f3f4f6', marginHorizontal: 8 },

    cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
    cardContainerWrapper: { width: W * 0.9, height: H * 0.58, position: 'relative' },
    cardContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 1 },

    emptyState: { alignItems: 'center', paddingHorizontal: 40 },
    emptyEmoji: { fontSize: 64, marginBottom: 16 },
    emptyTitle: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 32, marginBottom: 8 },
    emptySub: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 15, textAlign: 'center', marginBottom: 28 },
    goBackBtn: { borderRadius: 100, overflow: 'hidden', width: '100%', shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 },
    goBackGrad: { paddingVertical: 18, alignItems: 'center' },
    goBackTxt: { fontFamily: 'DMSans_700Bold', color: '#fff', fontSize: 17, letterSpacing: 0.5 },

    ghostHandContainer: { position: 'absolute', width: '100%', height: '100%', zIndex: 1000, elevation: 20, alignItems: 'center', justifyContent: 'center' },
    ghostHandLabels: { position: 'absolute', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
    ghostLabel: { position: 'absolute', width: '100%', alignItems: 'center' },
    ghostLabelPill: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 20, paddingVertical: 12, borderRadius: 100,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 10,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)'
    },
    ghostLabelTxt: { fontFamily: 'Syne_700Bold', color: '#fff', fontSize: 16, letterSpacing: 0.5 },
    ghostHandCircle: {
        width: 70, height: 70, borderRadius: 35,
        backgroundColor: 'rgba(255,107,107,0.95)',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: 'rgba(255,107,107,0.5)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 8,
        marginTop: 60 // Position hand below the labels
    },

    actions: {
        flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
        gap: 12, paddingBottom: 30, paddingTop: 10,
    },
    mainBtn: {
        width: 72, height: 72, borderRadius: 36,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#ffffff',
        shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 12,
    },
    deleteBtn: {
        shadowColor: 'rgba(239,68,68,0.25)', shadowOpacity: 1,
    },
    keepBtn: {
        shadowColor: 'rgba(34,197,94,0.25)', shadowOpacity: 1,
    },
    smallBtn: {
        width: 50, height: 50, borderRadius: 25,
        backgroundColor: '#ffffff',
        shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
        alignItems: 'center', justifyContent: 'center',
    },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sortSheet: {
        overflow: 'hidden',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: 20, paddingBottom: 48, paddingTop: 14,
        borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
        borderColor: 'rgba(0,0,0,0.05)',
    },
    sortHandle: {
        width: 40, height: 5, borderRadius: 3,
        backgroundColor: '#e5e7eb',
        alignSelf: 'center', marginBottom: 24,
    },
    sortTitle: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 20, marginBottom: 16, letterSpacing: -0.3 },
    sortOpt: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 14,
        borderRadius: 16, marginBottom: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1, borderColor: '#f3f4f6',
        shadowColor: 'rgba(0,0,0,0.02)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1,
    },
    sortIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    sortOptTxt: { fontFamily: 'DMSans_500Medium', color: '#4b5563', fontSize: 16 },

    // Celebration Popup
    celebOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    celebCard: {
        width: '100%', backgroundColor: '#ffffff', borderRadius: 32, paddingHorizontal: 28, paddingTop: 36, paddingBottom: 24,
        alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,107,107,0.1)',
        shadowColor: 'rgba(255,107,107,0.2)', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 1, shadowRadius: 32, elevation: 12,
    },
    celebShimmer: {
        position: 'absolute', top: 0, left: 24, right: 24, height: 1,
        backgroundColor: 'rgba(255,107,107,0.2)',
    },
    celebIconWrap: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(255,107,107,0.1)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    orbitContainer: { position: 'absolute', width: 96, height: 96, alignItems: 'center', justifyContent: 'flex-start' },
    orbitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff6b6b', shadowColor: '#ff6b6b', shadowOpacity: 0.5, shadowRadius: 6 },
    celebEmoji: { fontSize: 38 },
    celebTitle: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 22, marginBottom: 24, textAlign: 'center' },

    celebStorage: { alignItems: 'center', marginBottom: 28 },
    celebStorageVal: { fontFamily: 'DMSans_700Bold', color: '#ff6b6b', fontSize: 48, letterSpacing: -1.5, lineHeight: 56 },
    celebStorageUnit: { fontSize: 24, fontFamily: 'DMSans_700Bold' },
    celebStorageLbl: { fontFamily: 'DMSans_700Bold', color: '#9ca3af', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: -2 },

    celebStatsCol: { width: '100%', gap: 10, marginBottom: 24 },
    celebStatRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
        borderWidth: 1,
    },
    celebStatIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    celebStatNum: { fontFamily: 'DMSans_700Bold', fontSize: 24, width: 40 },
    celebStatLabel: { fontFamily: 'DMSans_500Medium', color: '#4b5563', fontSize: 16 },

    progressWrap: { width: '100%', marginBottom: 32 },
    progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    progressLbl: { fontFamily: 'DMSans_700Bold', color: '#9ca3af', fontSize: 12, textTransform: 'uppercase' },
    progressNum: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 14 },
    progressTrack: { width: '100%', height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: '#ff6b6b', borderRadius: 3 },

    celebPrimaryBtn: { width: '100%', borderRadius: 100, overflow: 'hidden', marginBottom: 12, shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
    celebPrimaryGrad: { paddingVertical: 18, alignItems: 'center', position: 'relative' },
    celebGlossTop: { position: 'absolute', top: 0, left: '10%', right: '10%', height: '40%', backgroundColor: 'rgba(255,255,255,0.3)', borderBottomLeftRadius: 100, borderBottomRightRadius: 100 },
    celebPrimaryTxt: { fontFamily: 'DMSans_700Bold', color: '#fff', fontSize: 17, letterSpacing: 0.5 },
    celebSecBtn: { paddingVertical: 12, paddingHorizontal: 24 },
    celebSecTxt: { fontFamily: 'DMSans_700Bold', color: '#9ca3af', fontSize: 15 },

    /* —————————————————— Full Preview —————————————————— */
    fullPreviewOverlay: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullPreviewContent: {
        width: W * 0.9,
        height: H * 0.75,
        borderRadius: 32,
        overflow: 'hidden',
        backgroundColor: '#111',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.5,
        shadowRadius: 40,
        elevation: 25,
    },
    fullPreviewImage: {
        width: '100%',
        height: '100%',
    },
    fullPreviewHeader: {
        position: 'absolute',
        top: 20,
        right: 20,
        zIndex: 100,
    },
    fullPreviewClose: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    fullPreviewFooter: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 30,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
    },
    fullPreviewTitle: {
        fontFamily: 'Syne_700Bold',
        color: '#fff',
        fontSize: 24,
        marginBottom: 4,
    },
    fullPreviewSub: {
        fontFamily: 'DMSans_500Medium',
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14,
    },
    
    /* —————————————————— Tutorial Step 2 Styles —————————————————— */
    tutBinOverlay: {
        width: '85%',
        alignSelf: 'center',
        backgroundColor: '#1f2937',
        borderRadius: 32,
        paddingHorizontal: 28,
        paddingTop: 36,
        paddingBottom: 28,
        alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.6, shadowRadius: 32, elevation: 20,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
    },
    tutIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(52,199,89,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    tutBinTitle: { fontFamily: 'Syne_700Bold', color: '#fff', fontSize: 26, marginBottom: 12, textAlign: 'center' },
    tutBinDesc: { fontFamily: 'DMSans_500Medium', color: '#d1d5db', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    tutBinDesc2: { fontFamily: 'DMSans_500Medium', color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 28 },
    tutBinBtn: { width: '100%', backgroundColor: '#fff', paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
    tutBinBtnText: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 18 },
    tutArrowContainer: { position: 'absolute', bottom: Platform.OS === 'ios' ? 90 : 70, right: W * 0.2, alignItems: 'center' },
    tutArrow: { fontSize: 64, color: '#fff', fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width: 0, height: 4}, textShadowRadius: 8 },
});
