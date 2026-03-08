import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    StyleSheet, Text, View, Dimensions, Pressable,
    Modal, Animated as RNAnimated, StatusBar, Platform, TextInput, Alert, Share
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as Sharing from 'expo-sharing';
import Animated, {
    useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, Easing,
    interpolate, Extrapolation, withSequence, withRepeat, useDerivedValue, useAnimatedProps, withDelay
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

/* ─── Animated counting number (Standard Text for best layout) ─── */
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
        categoryCounts
    } = usePhotos();

    const insets = useSafeAreaInsets();
    const router = useRouter();
    const translateX = useSharedValue(0);
    const soundRef = useRef<Audio.Sound | null>(null);
    const [showSort, setShowSort] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [isCalculatingInfo, setIsCalculatingInfo] = useState(false);
    const [detailedInfo, setDetailedInfo] = useState<{ size?: number; width?: number; height?: number } | null>(null);
    const [isSharing, setIsSharing] = useState(false);
    const sortProgress = useSharedValue(0);
    const activeCatRef = useRef<string>('Random');

    const [showCelebration, setShowCelebration] = useState(false);
    const [lastPopupSwiped, setLastPopupSwiped] = useState(0);
    const celebScale = useRef(new RNAnimated.Value(0.8)).current;
    const celebOpacity = useRef(new RNAnimated.Value(0)).current;
    const orbitSpin = useRef(new RNAnimated.Value(0)).current;

    /* ─── Intro Splash State ─── */
    const [showIntro, setShowIntro] = useState(true);
    const introShownRef = useRef(false);
    const [storage, setStorage] = useState<{ used: number; total: number } | null>(null);

    // Auto start session on focus or when permissions first load
    useFocusEffect(
        useCallback(() => {
            if (permissionsGranted && remainingCount === 0 && !isLoadingSession) {
                startSwipingSession('Random');
            }
        }, [permissionsGranted, remainingCount, isLoadingSession, startSwipingSession])
    );

    useEffect(() => {
        if (permissionsGranted && remainingCount === 0 && !isLoadingSession && !currentPhoto) {
            startSwipingSession('Random');
        }
    }, [permissionsGranted, remainingCount, isLoadingSession, currentPhoto, startSwipingSession]);

    useEffect(() => {
        if (permissionsGranted) {
            loadCategoryStats();
        }
    }, [permissionsGranted]);

    // Auto-dismiss intro after 4 seconds
    useEffect(() => {
        if (introShownRef.current) {
            setShowIntro(false);
            return;
        }

        if (showIntro) {
            const timer = setTimeout(() => {
                setShowIntro(false);
                introShownRef.current = true;
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [showIntro]);

    const fmt = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

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
        if (sessionStats.swiped > 0 && sessionStats.swiped % 100 === 0 && sessionStats.swiped !== lastPopupSwiped) {
            setLastPopupSwiped(sessionStats.swiped);
            setShowCelebration(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            RNAnimated.parallel([
                RNAnimated.spring(celebScale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
                RNAnimated.timing(celebOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
            ]).start();
        }
    }, [sessionStats.swiped, lastPopupSwiped]);

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
        // Start with fallback to avoid "Calculating..." hang
        setDetailedInfo({
            size: currentPhoto.fileSize || undefined,
            width: 0,
            height: 0
        });

        try {
            // Fetch high-precision info
            const info = await MediaLibrary.getAssetInfoAsync(currentPhoto.id, { shouldDownloadFromNetwork: true });
            let targetUri = info.localUri || info.uri;

            // If ph:// and it's a photo, convert to JPEG for accurate read
            if (targetUri && !targetUri.startsWith('file://') && Platform.OS === 'ios' && currentPhoto.mediaType === 'photo') {
                try {
                    const manip = await ImageManipulator.manipulateAsync(
                        targetUri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
                    );
                    targetUri = manip.uri;
                } catch (e) { console.warn("ImageManipulator fallback failed in openInfo", e); }
            } else if (targetUri && !targetUri.startsWith('file://') && Platform.OS === 'ios') {
                const tmp = `${(FileSystem as any).cacheDirectory}${currentPhoto.id}.info`;
                await FileSystem.copyAsync({ from: targetUri, to: tmp }).catch(() => { });
                targetUri = tmp;
            }

            let actualSize = 0;
            if (targetUri && targetUri.startsWith('file://')) {
                const fsInfo = await FileSystem.getInfoAsync(targetUri);
                if (fsInfo.exists && !fsInfo.isDirectory) actualSize = fsInfo.size;
            }

            setDetailedInfo({
                size: actualSize || (currentPhoto.fileSize || 0),
                width: info.width || 0,
                height: info.height || 0
            });
        } catch (error) {
            console.warn("Failed to get asset info:", error);
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

    // Swipe Tutorial Logic
    const TUTORIAL_SEEN_KEY = '@swipe_tutorial_seen_v3';
    const [showTutorial, setShowTutorial] = useState(false);
    const handOpacity = useSharedValue(0);

    const dismissTutorial = useCallback(async () => {
        if (showTutorial) {
            setShowTutorial(false);
            await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
        }
    }, [showTutorial]);

    useEffect(() => {
        async function checkTutorial() {
            const seen = await AsyncStorage.getItem(TUTORIAL_SEEN_KEY);
            if (seen !== 'true' && currentPhoto) {
                setShowTutorial(true);
            }
        }
        checkTutorial();
    }, [currentPhoto]);

    useEffect(() => {
        if (showTutorial) {
            handOpacity.value = withTiming(1, { duration: 400 });
            translateX.value = withRepeat(
                withSequence(
                    withTiming(0, { duration: 600 }),
                    withTiming(SWIPE_THRESHOLD * 1.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                    withTiming(0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
                    withTiming(-SWIPE_THRESHOLD * 1.5, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                    withTiming(0, { duration: 800, easing: Easing.inOut(Easing.ease) })
                ),
                -1 // loop infinitely
            );
        } else {
            handOpacity.value = withTiming(0, { duration: 300 });
        }
    }, [showTutorial]);

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
        dismissTutorial();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        swipeRight();
        translateX.value = 0;
    }, [dismissTutorial, swipeRight, translateX]);

    const handleSwipeLeft = useCallback(() => {
        dismissTutorial();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        playDeleteSound();
        swipeLeft();
        translateX.value = 0;
    }, [dismissTutorial, swipeLeft, translateX, playDeleteSound]);

    const panGesture = Gesture.Pan()
        .onBegin(() => {
            if (showTutorial) runOnJS(dismissTutorial)();
        })
        .onUpdate((e) => {
            translateX.value = e.translationX;
            if (
                (e.translationX > SWIPE_THRESHOLD && e.translationX - e.velocityX * 0.016 <= SWIPE_THRESHOLD) ||
                (e.translationX < -SWIPE_THRESHOLD && e.translationX - e.velocityX * 0.016 >= -SWIPE_THRESHOLD)
            ) { runOnJS(Haptics.selectionAsync)(); }
        })
        .onEnd((e) => {
            const velocityEffect = e.velocityX * 0.1;
            const finalX = e.translationX + velocityEffect;

            if (finalX > SWIPE_THRESHOLD) {
                translateX.value = withSpring(W * 1.5, {
                    velocity: e.velocityX,
                    stiffness: 110,
                    damping: 14,
                    mass: 0.4
                }, () => runOnJS(handleSwipeRight)());
            } else if (finalX < -SWIPE_THRESHOLD) {
                translateX.value = withSpring(-W * 1.5, {
                    velocity: e.velocityX,
                    stiffness: 110,
                    damping: 14,
                    mass: 0.4
                }, () => runOnJS(handleSwipeLeft)());
            } else {
                translateX.value = withSpring(0, {
                    velocity: e.velocityX,
                    damping: 30,
                    stiffness: 350,
                    mass: 0.4
                });
            }
        });



    // Dynamic overlay colours from gesture
    const keepOverlay = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    }));
    const deleteOverlay = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, -SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
    }));

    const renderCards = () => {
        if (!currentPhoto) return null;
        const cards = [];
        for (let i = VISIBLE_CARDS - 1; i >= 0; i--) {
            const idx = currentIndex + i;
            if (idx >= photos.length) continue;
            cards.push(
                <SwipeCard key={photos[idx].id} photo={photos[idx]} index={i}
                    totalVisible={VISIBLE_CARDS} translateX={translateX} isTop={i === 0} />
            );
        }
        return cards;
    };

    const sortLabel = sortMode === 'newest' ? 'Newest' : sortMode === 'oldest' ? 'Oldest' : 'Largest';

    /* ── INTRO SCREEN (early return) ── */
    if (showIntro) {
        return (
            <View style={s.container}>
                <StatusBar barStyle="dark-content" />
                <LinearGradient colors={['#fff0f5', '#ffffff', '#fef1f6']} style={StyleSheet.absoluteFill} />
                <View style={s.introOverlay}>
                    <FadeSlideIn delay={100}>
                        <Text style={s.introGreeting}>{getGreeting()} 👋</Text>
                        <Text style={s.introSub}>Here's your gallery at a glance</Text>
                    </FadeSlideIn>
                    <View style={s.introStatsRow}>
                        <FadeSlideIn delay={300} style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                                <Ionicons name="image" size={24} color="#6366f1" />
                            </View>
                            <CountUp to={categoryCounts.photos} delay={400} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Photos</Text>
                        </FadeSlideIn>
                        <FadeSlideIn delay={500} style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(236,72,153,0.12)' }]}>
                                <Ionicons name="videocam" size={24} color="#ec4899" />
                            </View>
                            <CountUp to={categoryCounts.videos} delay={600} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Videos</Text>
                        </FadeSlideIn>
                        <FadeSlideIn delay={700} style={s.introStatCard}>
                            <View style={[s.introStatIconWrap, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
                                <Ionicons name="phone-portrait" size={24} color="#22c55e" />
                            </View>
                            <CountUp to={categoryCounts.screenshots} delay={800} style={s.introStatNum} />
                            <Text style={s.introStatLabel}>Screenshots</Text>
                        </FadeSlideIn>
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
                        <Text style={s.introReady}>Let's free up some space! ✨</Text>
                    </FadeSlideIn>
                </View>
            </View>
        );
    }

    /* ── MAIN SWIPE SCREEN ── */
    return (
        <View style={s.container}>
            <StatusBar barStyle="dark-content" />
            <LinearGradient colors={['#fff0f5', '#ffffff', '#fff0f5']} style={StyleSheet.absoluteFill} />

            {/* Header */}
            <View style={[s.header, { paddingTop: Math.max(insets.top, 20) }]}>
                <View style={s.headerLeft}>
                    <Text numberOfLines={1} style={s.brandTitle}>
                        <Text style={s.headerTitleMain}>Swipe to </Text>
                        <Text style={s.headerTitleAccent}>Wipe</Text>
                    </Text>
                </View>
                <View style={s.headerRight}>
                    <Pressable
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            loadCategoryStats();
                        }}
                        style={s.headerIconBtn}
                    >
                        <Ionicons name="refresh" size={18} color="#9ca3af" />
                    </Pressable>
                    <Pressable onPress={openSort} style={s.combinedPill}>
                        <View style={s.pillLeft}>
                            <Ionicons name="funnel" size={12} color="#ff6b6b" />
                            <Text style={s.pillSortTxt} numberOfLines={1}>{sortLabel}</Text>
                        </View>
                        <View style={s.pillDivider} />
                        <Text style={s.pillCountTxt}>{remainingCount || 0}</Text>
                    </Pressable>
                </View>
            </View>

            {/* Cards */}
            <View style={s.cardArea}>
                {currentPhoto ? (
                    <View style={s.cardContainerWrapper}>
                        <GestureDetector gesture={panGesture}>
                            <Animated.View style={s.cardContainer}>
                                {renderCards()}
                            </Animated.View>
                        </GestureDetector>
                        <Animated.View style={[s.ghostHandContainer, handStyle]} pointerEvents="none">
                            <View style={s.ghostHandCircle}>
                                <FontAwesome5 name="hand-pointer" size={30} color="#ffffff" style={{ marginLeft: 6, marginTop: 4, transform: [{ rotate: '-15deg' }] }} />
                            </View>
                        </Animated.View>
                    </View>
                ) : (
                    <View style={s.emptyState}>
                        <Text style={s.emptyEmoji}>🎉</Text>
                        <Text style={s.emptyTitle}>All Done!</Text>
                        <Text style={s.emptySub}>Check the Delete Bin to clean up.</Text>
                        <Pressable style={s.goBackBtn} onPress={handleBack}>
                            <LinearGradient colors={['#ff6b6b', '#ff8e53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.goBackGrad}>
                                <Text style={s.goBackTxt}>Go Back</Text>
                            </LinearGradient>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* Action Bar */}
            {currentPhoto && (
                <View style={[s.actions, { paddingBottom: Math.max(insets.bottom, 20) + 84 }]}>
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
                        style={[s.mainBtn, s.keepBtn]}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            translateX.value = withSpring(W * 1.5, { velocity: 500, stiffness: 200, damping: 20 }, () => runOnJS(handleSwipeRight)());
                        }}
                    >
                        <Ionicons name="heart" size={36} color="#22c55e" />
                    </ScalePress>
                    <ScalePress
                        style={[s.smallBtn, isSharing && { opacity: 0.5 }]}
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

                                    const shareMessage = "Hey, look what i found while cleaning my phone! ✨\n\nDownload Swipe to Wipe: https://expo.dev/accounts/purvimotu/projects/photo-swipe";

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
                                                "WhatsApp sometimes skips the message. We've copied it to your clipboard so you can just 'Paste' it in the chat! ✨",
                                                [{ text: "Got it!" }]
                                            );
                                        }, 1000);
                                    } else {
                                        // Android: Sharing.shareAsync is better for files.
                                        await Sharing.shareAsync(shareUri, {
                                            dialogTitle: shareMessage,
                                            mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
                                        });
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
                        <Ionicons name="share-outline" size={22} color="#fca5a5" />
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
                                        <Text style={{ fontFamily: 'DMSans_700Bold', color: '#1f2937' }}>{new Date(currentPhoto.creationTime).toLocaleString()}</Text>
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
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },

    /* ── Intro Splash ── */
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

    header: {
        paddingHorizontal: 12, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    iconBtn: {
        width: 42, height: 42, borderRadius: 21,
        backgroundColor: '#ffffff',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: 'rgba(255,107,107,0.15)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4,
    },
    headerLeft: { flex: 1, paddingLeft: 2, marginRight: 4 },
    brandTitle: { flexDirection: 'row', alignItems: 'center' },
    headerTitleMain: { fontFamily: 'Syne_700Bold', color: '#1f2937', fontSize: 13, letterSpacing: -0.2 },
    headerTitleAccent: { fontFamily: 'Syne_800ExtraBold', color: '#ff6b6b', fontSize: 13, letterSpacing: -0.2 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
    headerIconBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    combinedPill: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#ffffff',
        paddingHorizontal: 4, paddingVertical: 4, borderRadius: 20,
        shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2,
        borderWidth: 1, borderColor: 'rgba(0,0,0,0.02)',
    },
    pillLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8 },
    pillSortTxt: { fontFamily: 'DMSans_700Bold', color: '#6b7280', fontSize: 13 },
    pillDivider: { width: 1, height: 14, backgroundColor: '#f3f4f6' },
    pillCountTxt: { fontFamily: 'Syne_800ExtraBold', color: '#ff6b6b', fontSize: 15, paddingHorizontal: 12 },

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
    ghostHandCircle: {
        width: 70, height: 70, borderRadius: 35,
        backgroundColor: 'rgba(255,107,107,0.95)',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: 'rgba(255,107,107,0.5)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 8
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
});
