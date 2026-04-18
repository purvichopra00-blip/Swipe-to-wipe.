import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    StyleSheet, Text, View, Dimensions, Pressable,
    Modal, Animated as RNAnimated, StatusBar, Platform, TextInput, Alert, Share,
    ActivityIndicator, ScrollView
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
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import { usePhotos, SortMode, DateFilter } from '../../contexts/PhotoContext';
import SwipeCard from '../../components/SwipeCard';
import { AppBannerAd, BannerAdSize, AdUnits, createSafeInterstitial, AdEventType } from '../../lib/ads';
import { AD_CONFIG } from '../../constants/Ads';

const { width: W, height: H } = Dimensions.get('window');
const SWIPE_THRESHOLD = W * 0.28;
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
        showIntro, setShowIntro,
        dateFilter, setDateFilter,
        showCalendar, setShowCalendar
    } = usePhotos();

    const insets = useSafeAreaInsets();
    const router = useRouter();
    const handOpacity = useSharedValue(0);
    const handX = useSharedValue(0);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);

    const logoScale = useSharedValue(1);
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
    const [showInfo, setShowInfo] = useState(false);
    const [isCalculatingInfo, setIsCalculatingInfo] = useState(false);
    const [detailedInfo, setDetailedInfo] = useState<{ size: number; width: number; height: number }>({ size: 0, width: 0, height: 0 });
    const [isSharing, setIsSharing] = useState(false);
    const sortProgress = useSharedValue(0);
    const dateProgress = useSharedValue(0);
    const { calendarTutorialSeen, setCalendarTutorialSeen } = usePhotos();
    const [localCalTutVisible, setLocalCalTutVisible] = useState(false);

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

    const [showFullPreview, setShowFullPreview] = useState(false);

    useEffect(() => {
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
        startSwipingSession(category);
        setShowIntro(false);
    };

    // Auto transition REMOVED as per user request - User must tap manually.

    const fmt = (b: number) => b > 1024 ** 2 * 900 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;

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
             text: `${lastYear} usually has the most hidden clutter — clean it first!`,
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
        if (showFullPreview && currentPhoto?.mediaType === 'video') {
            MediaLibrary.getAssetInfoAsync(currentPhoto.id).then(info => {
                setPreviewVideoUri(info.localUri || info.uri);
            });
        } else {
            setPreviewVideoUri(null);
        }
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
            const schedule = AD_CONFIG.INTERSTITIAL_PROGRESSIVE_SCHEDULE;
            const target = schedule[adsShownThisSession] || AD_CONFIG.INTERSTITIAL_MIN_INTERVAL;
            
            if (next >= target) {
                showAd();
                setAdsShownThisSession(s => s + 1);
                return 0; // Reset after triggering
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
            const schedule = AD_CONFIG.INTERSTITIAL_PROGRESSIVE_SCHEDULE;
            const target = schedule[adsShownThisSession] || AD_CONFIG.INTERSTITIAL_MIN_INTERVAL;

            if (next >= target) {
                showAd();
                setAdsShownThisSession(s => s + 1);
                return 0; // Reset after triggering
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
                    totalVisible={VISIBLE_CARDS} translateX={translateX} translateY={translateY} 
                    isTop={i === 0} hasFilter={!!dateFilter} />
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
                
                <View style={[s.introOverlay, { paddingTop: Math.max(insets.top, 84), paddingBottom: Math.max(insets.bottom, 40) }]}>
                    {/* 1. Header Section - Shine & Greeting */}
                    <View style={{ width: '100%', alignItems: 'center', marginBottom: 40 }}>
                        <FadeSlideIn delay={100}>
                            <View style={[s.introLogoCircle, { marginBottom: 20 }]}>
                                <Ionicons name="sparkles" size={48} color="#ff6b6b" />
                            </View>
                        </FadeSlideIn>
                        <FadeSlideIn delay={250}>
                            <Text style={s.introGreetingNice}>{getGreeting() + ' \uD83D\uDC4B'}</Text>
                        </FadeSlideIn>
                        <FadeSlideIn delay={350} style={{ marginTop: 6 }}>
                            <Text style={s.introTitleSmall}>Swipe to Wipe</Text>
                        </FadeSlideIn>
                    </View>

                    {/* 2. Middle Section - Balanced Gallery Summary */}
                    <FadeSlideIn delay={550} style={{ width: '100%' }}>
                        <View style={s.introHeroCard}>
                            <LinearGradient colors={['#ffffff', '#fff9fb']} style={StyleSheet.absoluteFill} />
                            <View style={s.introHeroContent}>
                                <Text style={s.introHeroLabel}>Your Gallery Summary</Text>
                                <View style={s.introHeroStats}>
                                    <View style={s.introHeroStat}>
                                        <View style={[s.introHeroIconWrap, { backgroundColor: '#fff4f4' }]}>
                                            <Ionicons name="image" size={24} color="#ff6b6b" />
                                        </View>
                                        <CountUp to={categoryCounts.photos} style={s.introHeroStatNum} delay={400} />
                                        <Text style={s.introHeroStatLbl}>Photos</Text>
                                    </View>
                                    <View style={s.introHeroStatDivider} />
                                    <View style={s.introHeroStat}>
                                        <View style={[s.introHeroIconWrap, { backgroundColor: '#fff4f4' }]}>
                                            <Ionicons name="videocam" size={24} color="#ff6b6b" />
                                        </View>
                                        <CountUp to={categoryCounts.videos} style={s.introHeroStatNum} delay={600} />
                                        <Text style={s.introHeroStatLbl}>Videos</Text>
                                    </View>
                                </View>
                                
                                <ScalePress 
                                    style={s.introMainBtn}
                                    onPress={() => enterSession('Random')}
                                >
                                    <LinearGradient colors={['#ff6b6b', '#ff8e53']} style={s.introMainBtnGrad}>
                                        <Text style={s.introMainBtnTxt}>Start Cleaning 🧹</Text>
                                    </LinearGradient>
                                </ScalePress>
                            </View>
                        </View>
                    </FadeSlideIn>

                    {/* 3. Footer Section - Storage Health Status */}
                    <View style={{ width: '100%', alignItems: 'center', marginTop: 44 }}>
                        {storage && (
                            <FadeSlideIn delay={800} style={s.introStorageWrap}>
                                <View style={s.introStorageHeader}>
                                    <Text style={s.introStorageTxt}>Storage Healthy</Text>
                                    <Text style={s.introStorageVal}>{fmt(storage.used)} / {fmt(storage.total)}</Text>
                                </View>
                                <View style={s.introStorageTrack}>
                                    <View style={[s.introStorageFill, { width: `${Math.min(100, (storage.used / storage.total) * 100)}%` }]} />
                                </View>
                            </FadeSlideIn>
                        )}
                        
                        <FadeSlideIn delay={1000}>
                            <Text style={s.introStatus}>
                                {totalClearedBytes > 0
                                    ? `✨ You've freed up ${(totalClearedBytes / (1024 * 1024)).toFixed(1)} MB!`
                                    : "Curating your story, one memory at a time"}
                            </Text>
                        </FadeSlideIn>
                    </View>
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
            <View style={[s.header, { paddingTop: Math.max(insets.top, 12) }]}>
                <View style={s.headerLeft}>
                    <ScalePress
                        style={{ padding: 4, marginRight: 8 }}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            setShowIntro(true);
                        }}
                    >
                        <Ionicons name="home-outline" size={20} color="#6366f1" />
                    </ScalePress>
                    <ScalePress onPress={() => setTutorialStep(1)}>
                        <Text style={s.title}>
                            Swipe to <Text style={s.titleBold}>Wipe</Text>
                        </Text>
                    </ScalePress>
                </View>


                    <View style={s.filterPill}>
                        <Ionicons name="heart" size={12} color="#22c55e" />
                        <Text style={s.pillCount}>{totalKeptPhotos}</Text>
                        <View style={s.pillSeparator} />
                        <Ionicons name="trash" size={12} color="#ef4444" />
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
                        <Text style={s.emptyEmoji}>
                            {dateFilter ? '✨' : '\uD83C\uDF89'}
                        </Text>
                        <Text style={s.emptyTitle}>
                            {dateFilter ? 'Crystal Clear!' : 'All Done!'}
                        </Text>
                        <Text style={s.emptySub}>
                            {dateFilter 
                                ? `Your ${dateFilter.day ? (dateFilter.day + ' ') : ''}${dateFilter.month !== undefined ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dateFilter.month] + ' ') : ''}${dateFilter.year} is already squeaky clean! 🧼`
                                : 'Nothing more to wipe here. You\'re a cleaning wizard! 🪄'}
                        </Text>
                        <Pressable style={s.goBackBtn} onPress={() => {
                            if (dateFilter) setDateFilter(null);
                            handleBack();
                        }}>
                            <LinearGradient colors={['#6366f1', '#8b5cf6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.goBackGrad}>
                                <Text style={s.goBackTxt}>{dateFilter ? 'Clear Filter' : 'Go Back'}</Text>
                            </LinearGradient>
                        </Pressable>

                        {!dateFilter && (
                            <ScalePress 
                                style={{ marginTop: 24, alignItems: 'center' }} 
                                onPress={() => {
                                    handleBack();
                                    setShowCalendar(true);
                                }}
                            >
                                <Text style={{ fontFamily: 'DMSans_700Bold', color: '#6366f1', fontSize: 15 }}>
                                    Ready for a deep dive? Clean up 2023 📅
                                </Text>
                            </ScalePress>
                        )}
                    </View>
                )}
            </View>

            <>
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
                                        Alert.alert('Download Failed', 'Could not fetch this media. Please check your internet connection.');
                                        return;
                                    }

                                    const isVideo = currentPhoto.mediaType === 'video';
                                    const ext = currentPhoto.filename?.split('.').pop()?.toLowerCase() || (isVideo ? 'mp4' : 'jpg');

                                    // WhatsApp rejects ph:// links and virtual content URIs.
                                    // Universally ensure the shareUri is a physical local file://
                                    if (!shareUri.startsWith('file://')) {
                                        try {
                                            const baseDir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory;
                                            if (!baseDir) throw new Error('No storage');
                                            
                                            const tmpDir = baseDir + 'shares/';
                                            await FileSystem.makeDirectoryAsync(tmpDir, { intermediates: true }).catch(() => { });
                                            const tmpFile = `${tmpDir}${currentPhoto.id}.${ext}`;
                                            await FileSystem.copyAsync({ from: shareUri, to: tmpFile });
                                            shareUri = tmpFile;
                                        } catch (err) {
                                            console.warn('Local resolution failed', err);
                                        }
                                    }

                                    const shareMessage = `Hey, look what I found while cleaning my phone! ✨\n\nGet Swipe to Wipe:\n🍏 iOS: https://apps.apple.com/us/app/swipe-to-wipe/id6761011430\n🤖 Android: https://play.google.com/store/apps/details?id=com.purvichopra.swipetowipe`;

                                    if (Platform.OS === 'ios') {
                                        // iOS supports combined sharing (File + Message) via built-in Share module
                                        // But first, let's ensure photos are JPEGs (iCloud/HEIC often fail in WhatsApp)
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
                                        // Android usually requires expo-sharing for local files to be reliable
                                        await Clipboard.setStringAsync(shareMessage);
                                        await Sharing.shareAsync(shareUri, {
                                            dialogTitle: 'Share with friends',
                                            mimeType: isVideo ? `video/${ext === 'mov' ? 'quicktime' : 'mp4'}` : "image/jpeg",
                                        });

                                        // Toast-like feedback for Android since message is copied
                                        setTimeout(() => {
                                            Alert.alert(
                                                "Message Copied!",
                                                "Social apps on Android often skip the message when a file is shared directly. We've copied it to your clipboard so you can just 'Paste' it in the chat! \u2728",
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
                                                <Ionicons name="time" size={38} color="#6366f1" />
                                            </View>
                                            <Text style={s.calTutTitle}>Clean your history 🕰️</Text>
                                            <Text style={s.calTutDesc}>
                                                Pick a year or month to find and sweep away older photos.
                                            </Text>
                                            
                                            <ScalePress style={s.calTutBtn} onPress={dismissCalTutorial}>
                                                <Text style={s.calTutBtnText}>Got it</Text>
                                            </ScalePress>
                                        </Animated.View>
                                    )}

                                    {/* 1. Header Copy */}
                                    <View style={{ marginBottom: 20 }}>
                                        <Text style={s.emotionalHook}>Revisit your moments</Text>
                                        <Text style={s.emotionalSub}>Clean them, one swipe at a time</Text>
                                    </View>

                                    {/* 2. What do you want to clean? (Former Quick Jumps) */}
                                    <View style={{ marginBottom: 24 }}>
                                        <Text style={s.sectionLabel}>What do you want to clean? 🔍</Text>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 14, paddingBottom: 10 }}>
                                            <ScalePress 
                                                style={s.smartCard} 
                                                onPress={() => {
                                                    const filter: DateFilter = { year: new Date().getFullYear(), month: new Date().getMonth(), day: undefined, mediaType: 'all' };
                                                    setDateFilter(filter);
                                                    closeDatePicker();
                                                    startSwipingSession('Random', filter);
                                                }}
                                            >
                                                <View style={[s.smartIcon, { backgroundColor: '#f0f9ff' }]}>
                                                    <Ionicons name="time" size={20} color="#0ea5e9" />
                                                </View>
                                                <Text style={s.smartLabel}>Last 30{"\n"}Days</Text>
                                            </ScalePress>
                                            <ScalePress 
                                                style={s.smartCard} 
                                                onPress={() => {
                                                    const filter: DateFilter = { year: new Date().getFullYear(), mediaType: 'all' };
                                                    setDateFilter(filter);
                                                    closeDatePicker();
                                                    startSwipingSession('Random', filter);
                                                }}
                                            >
                                                <View style={[s.smartIcon, { backgroundColor: '#fef2f2' }]}>
                                                    <Ionicons name="calendar" size={20} color="#ef4444" />
                                                </View>
                                                <Text style={s.smartLabel}>This{"\n"}Year</Text>
                                            </ScalePress>
                                            <ScalePress 
                                                style={s.smartCard} 
                                                onPress={() => {
                                                    setDateFilter(null);
                                                    closeDatePicker();
                                                    startSwipingSession('Videos', null);
                                                }}
                                            >
                                                <View style={[s.smartIcon, { backgroundColor: '#fff1f2' }]}>
                                                    <Ionicons name="videocam" size={20} color="#f43f5e" />
                                                </View>
                                                <Text style={s.smartLabel}>Videos 🎬</Text>
                                            </ScalePress>
                                            <ScalePress 
                                                style={s.smartCard} 
                                                onPress={() => {
                                                    setSortMode('random' as any); setDateFilter(null); closeDatePicker();
                                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                                    startSwipingSession('Random', null);
                                                }}
                                            >
                                                <View style={[s.smartIcon, { backgroundColor: '#f5f3ff' }]}>
                                                    <Ionicons name="dice" size={20} color="#8b5cf6" />
                                                </View>
                                                <Text style={s.smartLabel}>Random{"\n"}Entries 🎲</Text>
                                            </ScalePress>
                                        </ScrollView>
                                    </View>

                                    {/* 3. Year Selection */}
                                    <View style={{ marginBottom: 24 }}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                                            <Text style={s.sectionLabel}>Pick a Year</Text>
                                            {dateFilter?.year && (
                                                <ScalePress 
                                                    style={[s.entireYearBadge, !dateFilter.month && { backgroundColor: '#22c55e' }]} 
                                                    onPress={() => selectDate(dateFilter.year, undefined, undefined, false)}
                                                >
                                                    <Text style={[s.entireYearTxt, !dateFilter.month && { color: '#fff' }]}>
                                                        {dateFilter.month === undefined ? 'Full Year Selected' : 'Clean full year →'}
                                                    </Text>
                                                    {!dateFilter.month && <Ionicons name="checkmark-sharp" size={12} color="#fff" />}
                                                </ScalePress>
                                            )}
                                        </View>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: 40, paddingBottom: 10 }}>
                                            {[2026, 2025, 2024, 2023, 2022, 2021, 2020].map(y => {
                                                const isSelected = dateFilter?.year === y;
                                                return (
                                                    <ScalePress 
                                                        key={y} 
                                                        style={[s.yearPill, isSelected && s.yearPillActive, !!dateFilter?.year && !isSelected && { opacity: 0.35 }]} 
                                                        onPress={() => selectDate(y)}
                                                    >
                                                        <Text style={[s.yearPillTxt, isSelected && s.yearPillTxtActive]}>{y}</Text>
                                                    </ScalePress>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>

                                    {/* 4. Month Grid */}
                                    {dateFilter?.year && (
                                        <View style={{ marginBottom: 24 }}>
                                            <Text style={s.sectionLabel}>Explore {dateFilter.year}</Text>
                                            <View style={s.monthsGrid}>
                                                {[
                                                    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
                                                ].map((m, i) => {
                                                    const now = new Date();
                                                    const isFuture = dateFilter?.year === now.getFullYear() && i > now.getMonth();
                                                    const isSelected = dateFilter?.month === i;
                                                    return (
                                                        <ScalePress 
                                                            key={m} disabled={isFuture}
                                                            style={[s.monthBtn, isSelected && s.monthBtnActive, isFuture && { opacity: 0.15 }]} 
                                                            onPress={() => selectDate(dateFilter.year, i, undefined, false)}
                                                        >
                                                            <Text style={[s.monthTxt, isSelected && s.monthTxtActive]}>{m}</Text>
                                                            {isFuture && <Ionicons name="lock-closed" size={10} color="#9ca3af" style={{ marginTop: 4 }} />}
                                                        </ScalePress>
                                                    );
                                                })}
                                            </View>
                                        </View>
                                    )}


                                    {/* 6. High-Intent Global CTA */}
                                    {dateFilter?.year && (
                                        <ScalePress style={[s.globalJumpBtn, { marginTop: 20, marginBottom: 12 }]} onPress={confirmTimeJump}>
                                            <LinearGradient colors={['#ff6b6b', '#f43f5e']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.globalJumpGrad}>
                                                <Ionicons name="rocket" size={20} color="#fff" />
                                                <Text style={s.globalJumpTxt}>
                                                    {dateFilter.month !== undefined 
                                                        ? `Clean ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dateFilter.month]} ${dateFilter.year} →`
                                                        : `Swipe ${dateFilter.year} →`}
                                                </Text>
                                            </LinearGradient>
                                        </ScalePress>
                                    )}

                                    {/* 7. Actionable Pro Tip */}
                                    <View style={s.proTip}>
                                        <View style={s.proIcon}><Ionicons name="bulb" size={20} color="#ff6b6b" /></View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={s.proTitle}>Pro Tip</Text>
                                            <Text style={s.proSub}>{currentProTip.text}</Text>
                                        </View>
                                        <ScalePress style={s.proGoBtn} onPress={currentProTip.action}><Text style={s.proGoTxt}>Go</Text></ScalePress>
                                    </View>
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
                </>
            </View>
        );
    }

        const s = StyleSheet.create({
            container: { flex: 1, backgroundColor: '#fff' },
            
            /* —————————————————— Intro Screen Styles —————————————————— */
            introOverlay: { flex: 1, paddingHorizontal: 40, alignItems: 'center' },
            introLogoCircle: { 
                width: 90, height: 90, borderRadius: 45, backgroundColor: '#ffffff',
                justifyContent: 'center', alignItems: 'center',
                shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 10
            },
            introGreetingNice: { fontFamily: 'Syne_400Regular', fontSize: 24, color: '#1f2937', letterSpacing: 0, textAlign: 'center' },
            introTitleSmall: { fontFamily: 'Syne_800ExtraBold', fontSize: 20, color: '#ff6b6b', opacity: 0.8, textAlign: 'center' },
            
            introHeroCard: { 
                width: '100%', 
                borderRadius: 44, 
                overflow: 'hidden',
                shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.08, shadowRadius: 40, elevation: 12,
                borderWidth: 1.5, borderColor: '#fff'
            },
            introHeroContent: { padding: 40, alignItems: 'center' },
            introHeroLabel: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 20 },
            introHeroStats: { flexDirection: 'row', alignItems: 'center', gap: 32, marginBottom: 32 },
            introHeroStat: { alignItems: 'center' },
            introHeroIconWrap: { width: 56, height: 56, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
            introHeroStatNum: { fontFamily: 'DMSans_700Bold', fontSize: 28, color: '#1f2937', letterSpacing: -0.5 },
            introHeroStatLbl: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', marginTop: 4, letterSpacing: 1 },
            introHeroStatDivider: { width: 1.5, height: 40, backgroundColor: '#f3f4f6' },
            
            introMainBtn: { width: '100%', height: 64, borderRadius: 24, overflow: 'hidden' },
            introMainBtnGrad: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
            introMainBtnTxt: { fontFamily: 'DMSans_700Bold', fontSize: 18, color: '#fff' },

            introStorageWrap: { width: '100%', marginBottom: 24 },
            introStorageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
            introStorageTxt: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 13 },
            introStorageVal: { fontFamily: 'DMSans_500Medium', color: '#9ca3af', fontSize: 11 },
            introStorageTrack: { width: '100%', height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden' },
            introStorageFill: { height: '100%', backgroundColor: '#ff6b6b' },
            introStatus: { fontFamily: 'DMSans_500Medium', color: '#9ca3af', fontSize: 13, textAlign: 'center' },
            overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
            header: {
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingHorizontal: 20, paddingBottom: 10, zIndex: 10,
            },
            headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
            headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
            title: { fontFamily: 'DMSans_400Regular', fontSize: 18, color: '#1f2937', letterSpacing: -0.2 },
            titleBold: { fontFamily: 'Syne_800ExtraBold', color: '#ff6b6b' },

            activeFilterPill: { 
                flexDirection: 'row', alignItems: 'center', 
                backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                shadowColor: 'rgba(0,0,0,0.04)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2,
                borderWidth: 1, borderColor: '#f3f4f6'
            },
            activeFilterTxt: { fontFamily: 'DMSans_700Bold', color: '#ff6b6b', fontSize: 13, marginLeft: 6 },

            iconCircle: { 
                width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', 
                alignItems: 'center', justifyContent: 'center', 
                shadowColor: 'rgba(0,0,0,0.04)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 2,
                borderWidth: 1, borderColor: '#f3f4f6'
            },
            
            filterPill: {
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#ffffff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
                shadowColor: 'rgba(255,107,107,0.12)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3,
                borderWidth: 1.5, borderColor: '#fef2f2',
            },
            pillCount: { fontFamily: 'Syne_700Bold', color: '#22c55e', fontSize: 13, marginLeft: 2 },
            pillTotal: { fontFamily: 'Syne_700Bold', color: '#ef4444', fontSize: 13, marginLeft: 2 },
            pillSeparator: { width: 1.5, height: 12, backgroundColor: '#f3f4f6', marginHorizontal: 8 },

            cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
            cardContainerWrapper: { width: W * 0.9, height: H * 0.58, position: 'relative' },
            cardContainer: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', zIndex: 1 },

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
            deleteBtn: { shadowColor: 'rgba(239,68,68,0.25)', shadowOpacity: 1 },
            keepBtn: { shadowColor: 'rgba(34,197,94,0.25)', shadowOpacity: 1 },
            smallBtn: {
                width: 50, height: 50, borderRadius: 25,
                backgroundColor: '#ffffff',
                shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
                alignItems: 'center', justifyContent: 'center',
            },

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
                marginTop: 60
            },

            sortSheet: {
                overflow: 'hidden',
                borderTopLeftRadius: 36, borderTopRightRadius: 36,
                paddingHorizontal: 20, paddingBottom: 20, 
                paddingTop: 12,
                maxHeight: H * 0.94,
                minHeight: H * 0.6,
                borderTopWidth: 1.5, borderColor: 'rgba(0,0,0,0.05)',
                backgroundColor: '#fff',
            },
            emotionalHook: { fontFamily: 'Syne_700Bold', color: '#1f2937', fontSize: 22, letterSpacing: -0.5, marginTop: 12 },
            emotionalSub: { fontFamily: 'DMSans_500Medium', color: '#9ca3af', fontSize: 13, marginTop: 4 },

            smartCard: { width: 96, paddingVertical: 18, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: '#f9fafb' },
            smartIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
            smartLabel: { fontFamily: 'DMSans_700Bold', fontSize: 11, color: '#4b5563', textAlign: 'center', lineHeight: 14, letterSpacing: 0.1 },

            sectionLabel: { fontFamily: 'DMSans_700Bold', color: '#111827', fontSize: 16, letterSpacing: -0.4 },
            yearPill: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 18, backgroundColor: '#f9fafb', borderWidth: 1.5, borderColor: '#f3f4f6' },
            yearPillActive: { backgroundColor: '#ff6b6b', borderColor: '#ff6b6b', shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8, transform: [{ scale: 1.05 }] },
            yearPillTxt: { fontFamily: 'DMSans_700Bold', fontSize: 17, color: '#9ca3af' },
            yearPillTxtActive: { color: '#fff' },

            entireYearBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,107,107,0.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 100 },
            entireYearTxt: { fontFamily: 'DMSans_700Bold', fontSize: 12, color: '#ff6b6b' },
            selectFullYearBtn: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#ff6b6b', opacity: 0.7 },

            monthsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
            monthBtn: { width: (W - 70) / 4, paddingVertical: 14, alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 16, borderWidth: 1, borderColor: '#f3f4f6' },
            monthBtnActive: { backgroundColor: '#ff6b6b', borderColor: '#ff6b6b', shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 5 },
            monthEmoji: { fontSize: 20, marginBottom: 6 },
            monthTxt: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#374151' },
            monthTxtActive: { color: '#fff' },

            mediaToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: '#f3f4f6' },
            mediaToggleActive: { backgroundColor: '#ff6b6b' },
            mediaToggleTxt: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#6b7280' },
            mediaToggleTxtActive: { color: '#fff' },

            globalJumpBtn: { marginTop: 10, borderRadius: 16, overflow: 'hidden', shadowColor: '#6366f1', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
            globalJumpGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
            globalJumpTxt: { fontFamily: 'DMSans_700Bold', color: '#fff', fontSize: 16 },

            proTip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff7f7', padding: 20, borderRadius: 24, gap: 16, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,107,107,0.1)' },
            proIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
            proTitle: { fontFamily: 'DMSans_700Bold', fontSize: 15, color: '#1f2937' },
            proSub: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#6b7280', lineHeight: 18, marginTop: 2 },
            proGoBtn: { backgroundColor: '#ff6b6b', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, shadowColor: '#ff6b6b', shadowOpacity: 0.3, shadowRadius: 8, elevation: 3 },
            proGoTxt: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#fff' },

            clearTimeMachine: { width: '100%', paddingVertical: 24, alignItems: 'center' },
            clearTimeMachineTxt: { fontFamily: 'DMSans_700Bold', color: '#9ca3af', fontSize: 14, letterSpacing: 0.5 },

            sortHandle: {
                width: 40, height: 5, borderRadius: 3,
                backgroundColor: '#e5e7eb',
                alignSelf: 'center', marginBottom: 24,
            },
            sortTitle: { fontFamily: 'Syne_700Bold', color: '#1f2937', fontSize: 24, marginBottom: 20, textAlign: 'center' },
            sortOpt: { 
                flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, 
                backgroundColor: '#fff', marginBottom: 12, borderWidth: 1.5, borderColor: '#f3f4f6' 
            },
            sortIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
            sortOptTxt: { fontFamily: 'DMSans_700Bold', color: '#4b5563', fontSize: 17 },

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
            celebStatNum: { fontFamily: 'DMSans_700Bold', fontSize: 24, paddingRight: 8 },
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

            /* —————————————————— Calendar Tutorial (Indigo Glass) —————————————————— */
            calTutCard: {
                width: '94%', alignSelf: 'center', backgroundColor: 'rgba(99,102,241,0.06)', borderRadius: 28,
                paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24, alignItems: 'center',
                borderWidth: 1.5, borderColor: 'rgba(99,102,241,0.1)',
            },
            calTutIconWrap: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 18, shadowColor: '#6366f1', shadowOpacity: 0.1, shadowRadius: 10, elevation: 3 },
            calTutTitle: { fontFamily: 'Syne_700Bold', color: '#1f2937', fontSize: 24, marginBottom: 10, textAlign: 'center' },
            calTutDesc: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 16, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
            calTutBtn: { width: '80%', backgroundColor: '#6366f1', paddingVertical: 14, borderRadius: 100, alignItems: 'center', shadowColor: '#6366f1', shadowOpacity: 0.2, shadowRadius: 10, elevation: 4 },
            calTutBtnText: { fontFamily: 'DMSans_700Bold', color: '#fff', fontSize: 16 },
        });
