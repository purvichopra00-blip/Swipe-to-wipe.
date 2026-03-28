import React, { useRef, useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, Text, Dimensions, NativeSyntheticEvent, NativeScrollEvent, Pressable, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedScrollHandler, useSharedValue, useAnimatedStyle,
    interpolate, Extrapolation, withTiming, withRepeat,
    withSequence, Easing, SharedValue, useAnimatedProps,
    withDelay, runOnJS, withSpring
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { logEvent, TrackEvents } from '../lib/analytics';
import { ONBOARDING_COMPLETED_KEY } from '../lib/firebase';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DUMMY_PHOTOS = [
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=800&auto=format&fit=crop', // Girl
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=800&auto=format&fit=crop', // Girl 2
    'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=800&auto=format&fit=crop', // Fashion
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=800&auto=format&fit=crop', // Portrait
];

const SLIDES = [
    {
        id: '1',
        title: 'Your gallery is\ncluttered.',
        description: 'Thousands of forgotten photos, screenshots, and old memes are secretly eating up your phone storage.',
        icon: 'images' as const,
        colors: ['#ff8e53', '#ff6b6b'],
    },
    {
        id: '2',
        title: 'Swipe to clean\nin minutes.',
        description: 'Keep the memories you love. Swiftly trash the rest with incredibly satisfying swipe gestures.',
        icon: 'albums' as const,
        colors: ['#ff6b6b', '#fca5a5'],
    },
    {
        id: '3',
        title: 'We never delete\nrandomly.',
        description: "Items go into a safe staging Bin. You have full control deciding when to empty the trash—no surprises.",
        icon: 'shield-checkmark' as const,
        colors: ['#fca5a5', '#ff8e53'],
    },
];



// Safe component for animated slides
const SlideItem = ({ slide, index, scrollX }: { slide: any, index: number, scrollX: SharedValue<number> }) => {
    const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];

    const textTranslateStyle = useAnimatedStyle(() => {
        const translateY = interpolate(scrollX.value, inputRange, [50, 0, -50], Extrapolation.CLAMP);
        const opacity = interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP);
        return { transform: [{ translateY }], opacity };
    });

    const iconScaleStyle = useAnimatedStyle(() => {
        const scale = interpolate(scrollX.value, inputRange, [0.8, 1, 0.8], Extrapolation.CLAMP);
        return { transform: [{ scale }] };
    });

    return (
        <View style={styles.slide}>
            <View style={styles.iconContainer}>
                <Animated.View style={[styles.circle, iconScaleStyle]}>
                    <View style={styles.circleInner}>
                        <LinearGradient colors={slide.colors as [string, string]} style={StyleSheet.absoluteFillObject} />
                        <Ionicons name={slide.icon} size={64} color="#fff" />
                    </View>
                </Animated.View>
            </View>
            <Animated.View style={[styles.textContainer, textTranslateStyle]}>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.subtitle}>{slide.description}</Text>
            </Animated.View>
        </View>
    );
};

// Safe component for animated dots
const PaginationDot = ({ index, scrollX }: { index: number, scrollX: SharedValue<number> }) => {
    const dotStyle = useAnimatedStyle(() => {
        const width = interpolate(scrollX.value, [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH], [8, 24, 8], Extrapolation.CLAMP);
        const opacity = interpolate(scrollX.value, [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH], [0.3, 1, 0.3], Extrapolation.CLAMP);
        return { width, opacity };
    });
    return <Animated.View style={[styles.dot, dotStyle]} />;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ScalePress({ children, onPress, style, disabled }: { children: React.ReactNode, onPress?: () => void, style?: any, disabled?: boolean }) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }]
    }));

    return (
        <AnimatedPressable
            disabled={disabled}
            onPress={onPress}
            onPressIn={() => { scale.value = withSpring(0.92, { damping: 10, stiffness: 400 }); }}
            onPressOut={() => { scale.value = withSpring(1, { damping: 10, stiffness: 400 }); }}
            style={[style, animatedStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function PlanCountUp({ to, duration = 2000, style, delay = 0 }: { to: number; duration?: number; style?: any; delay?: number }) {
    const count = useSharedValue(0);
    useEffect(() => {
        count.value = withDelay(delay, withTiming(to, { duration, easing: Easing.out(Easing.quad) }));
    }, [to, delay, duration]);
    const animatedProps = useAnimatedProps(() => ({
        text: count.value.toFixed(1),
    } as any));
    return (
        <AnimatedTextInput
            underlineColorAndroid="transparent"
            editable={false}
            defaultValue="0.0"
            style={[style, { padding: 0 }]}
            animatedProps={animatedProps}
        />
    );
}

export default function OnboardingScreen() {
    const router = useRouter();
    const [phase, setPhase] = useState<'scan' | 'result' | 'onboarding'>('scan');
    const [scanStep, setScanStep] = useState(0);
    const [mockPhotoIdx, setMockPhotoIdx] = useState(0);
    const [currentIndex, setCurrentIndex] = useState(0);
    const scrollRef = useRef<Animated.ScrollView>(null);
    const scrollX = useSharedValue(0);
    const [status, requestPermission] = MediaLibrary.usePermissions();
    const [realStorage, setRealStorage] = useState<{ used: number; total: number } | null>(null);

    // Fetch real storage info
    useEffect(() => {
        // Pre-fetch dummy images for smooth result phase
        DUMMY_PHOTOS.forEach(url => Image.prefetch(url));

        (async () => {
            const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
            if (completed === 'true') {
                console.log('Onboarding already complete, skipping...');
                router.replace('/(auth)/login');
                return;
            }

            try {
                let free = 0;
                let total = 0;
                try {
                    free = await FileSystem.getFreeDiskStorageAsync();
                    total = await FileSystem.getTotalDiskCapacityAsync();
                } catch (e) {
                    console.log('FileSystem storage native methods failed in onboarding');
                }
                if (total > 0) setRealStorage({ used: total - free, total });
            } catch { /* fallback to default */ }
        })();
    }, []);

    // Phase transition opacity
    const phaseOpacity = useSharedValue(1);

    const transitionTo = useCallback((newPhase: 'scan' | 'result' | 'onboarding') => {
        phaseOpacity.value = withTiming(0, { duration: 300 }, () => {
            runOnJS(setPhase)(newPhase);
            phaseOpacity.value = withTiming(1, { duration: 400 });
        });
    }, []);

    const animatedPhaseStyle = useAnimatedStyle(() => ({
        opacity: phaseOpacity.value,
        flex: 1
    }));

    // Scan phase logic
    useEffect(() => {
        if (phase !== 'scan') return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (scanStep < 3) {
            const timer = setTimeout(() => {
                setScanStep(s => s + 1);
            }, 1500);
            return () => clearTimeout(timer);
        } else {
            const timer = setTimeout(() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                transitionTo('result');
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [scanStep, phase, transitionTo]);

    const skipScan = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        transitionTo('onboarding');
    };

    // Onboarding scroll logic
    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollX.value = event.contentOffset.x;
        },
    });

    const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offset = e.nativeEvent.contentOffset.x;
        const newIndex = Math.round(offset / SCREEN_WIDTH);
        if (newIndex !== currentIndex) {
            setCurrentIndex(newIndex);
            Haptics.selectionAsync();
        }
    };

    const handleNext = useCallback(async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (currentIndex < SLIDES.length - 1) {
            scrollRef.current?.scrollTo({ x: (currentIndex + 1) * SCREEN_WIDTH, animated: true });
        } else {
            // Sequential Flow: Onboarding Done -> Go to Login
            await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
            logEvent(TrackEvents.ONBOARDING_COMPLETE);
            router.replace('/(auth)/login');
        }
    }, [currentIndex, router]);

    // Simulated Swipe Card Animation
    const swipeAnim = useSharedValue(0);
    const rotateAnim = useSharedValue(0);

    useEffect(() => {
        if (phase === 'result') {
            swipeAnim.value = withRepeat(
                withSequence(
                    withTiming(0, { duration: 400 }),
                    withTiming(SCREEN_WIDTH, { duration: 500, easing: Easing.in(Easing.ease) }),
                    withTiming(0, { duration: 0 }),
                    withTiming(0, { duration: 400 }),
                    withTiming(-SCREEN_WIDTH, { duration: 500, easing: Easing.in(Easing.ease) }),
                    withTiming(0, { duration: 0 })
                ),
                -1, false
            );
            rotateAnim.value = withRepeat(
                withSequence(
                    withTiming(0, { duration: 400 }),
                    withTiming(25, { duration: 500, easing: Easing.in(Easing.ease) }),
                    withTiming(0, { duration: 0 }),
                    withTiming(0, { duration: 400 }),
                    withTiming(-25, { duration: 500, easing: Easing.in(Easing.ease) }),
                    withTiming(0, { duration: 0 })
                ),
                -1, false
            );

            // Cycle dummy photos
            const photoInterval = setInterval(() => {
                setMockPhotoIdx(prev => (prev + 1) % DUMMY_PHOTOS.length);
            }, 900); // changes every swipe
            return () => clearInterval(photoInterval);
        }
    }, [phase]);

    const swipeStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { translateX: swipeAnim.value },
                { rotate: `${rotateAnim.value}deg` }
            ]
        };
    });

    const keepLabelStyle = useAnimatedStyle(() => {
        return { opacity: withTiming(swipeAnim.value > 30 ? 1 : 0, { duration: 150 }) };
    });

    const deleteLabelStyle = useAnimatedStyle(() => {
        return { opacity: withTiming(swipeAnim.value < -30 ? 1 : 0, { duration: 150 }) };
    });

    const renderScanPhase = () => (
        <View style={styles.scanContainer}>
            <ScalePress style={styles.skipBtn} onPress={skipScan}>
                <Text style={styles.skipTxt}>Skip</Text>
            </ScalePress>

            <View style={styles.scanContent}>
                <View style={styles.scannerCircle}>
                    <Ionicons name="scan-circle-outline" size={100} color="#ff6b6b" />
                    <Animated.View style={[styles.scannerRing, {
                        transform: [{ scale: 1 + (scanStep * 0.1) }],
                        opacity: 1 - (scanStep * 0.2)
                    }]} />
                </View>

                <View style={styles.scanSteps}>
                    <Text style={[styles.scanStepTxt, scanStep >= 0 && styles.scanStepActive]}>
                        {scanStep === 0 ? 'Analyzing photos...' : 'Photos analyzed ✓'}
                    </Text>
                    <Text style={[styles.scanStepTxt, scanStep >= 1 && styles.scanStepActive]}>
                        {scanStep < 1 ? 'Detecting duplicates...' : scanStep === 1 ? 'Detecting duplicates...' : 'Duplicates found ✓'}
                    </Text>
                    <Text style={[styles.scanStepTxt, scanStep >= 2 && styles.scanStepActive]}>
                        {scanStep < 2 ? 'Checking large files...' : scanStep === 2 ? 'Checking large files...' : 'Large files sorted ✓'}
                    </Text>
                </View>

                <View style={styles.scanDots}>
                    {[0, 1, 2].map(i => (
                        <View key={i} style={[styles.scanDot, scanStep >= i && styles.scanDotActive]} />
                    ))}
                </View>
            </View>
        </View>
    );

    const renderResultPhase = () => (
        <View style={styles.scanContainer}>
            <Pressable style={styles.skipBtn} onPress={skipScan}>
                <Text style={styles.skipTxt}>Skip</Text>
            </Pressable>

            <View style={styles.resultContent}>
                <Text style={styles.resultTitle}>You could free up</Text>
                <View style={styles.resultAmount}>
                    <PlanCountUp
                        to={realStorage ? (realStorage.used / 1024 ** 3) : 2.3}
                        style={styles.resultAmountText}
                        delay={300}
                    />
                    <Text style={styles.resultUnit}>GB</Text>
                </View>

                <View style={styles.previewContainer}>
                    <Animated.View style={[styles.previewCard, swipeStyle]}>
                        <Image
                            source={{ uri: DUMMY_PHOTOS[mockPhotoIdx] }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                        />
                        <View style={styles.previewCardOverlay} />

                        <Animated.View style={[styles.previewLabelWrap, { top: 16, left: 16, transform: [{ rotate: '-15deg' }] }, keepLabelStyle]}>
                            <Text style={styles.previewKeepTxt}>KEEP</Text>
                        </Animated.View>

                        <Animated.View style={[styles.previewLabelWrap, { top: 16, right: 16, transform: [{ rotate: '15deg' }] }, deleteLabelStyle]}>
                            <Text style={styles.previewDeleteTxt}>DELETE</Text>
                        </Animated.View>
                    </Animated.View>
                    <View style={styles.previewCardShadow} />
                </View>

                <Text style={styles.resultSub}>Ready to start swiping?</Text>

                <View style={styles.buttonWrapResult}>
                    <ScalePress
                        style={styles.button}
                        onPress={() => transitionTo('onboarding')}
                    >
                        <LinearGradient
                            colors={['#ff6b6b', '#ff8e53']}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            style={styles.buttonGrad}
                        >
                            <Text style={styles.buttonText}>See How It Works</Text>
                            <Ionicons name="arrow-forward" size={20} color="#fff" />
                        </LinearGradient>
                    </ScalePress>
                </View>
            </View>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <LinearGradient colors={['#fff0f5', '#ffffff']} style={StyleSheet.absoluteFillObject} />

            {/* Decorative background blobs - moved to corners to avoid confusion with buttons */}
            <View style={[styles.blob, { top: -200, left: -100, backgroundColor: 'rgba(255,107,107,0.04)' }]} />
            <View style={[styles.blob, { bottom: -220, right: -120, backgroundColor: 'rgba(255,142,83,0.04)' }]} />

            <Animated.View style={animatedPhaseStyle}>
                {phase === 'scan' && renderScanPhase()}
                {phase === 'result' && renderResultPhase()}

                {phase === 'onboarding' && (
                    <>
                        <Animated.ScrollView
                            ref={scrollRef as any}
                            horizontal
                            pagingEnabled
                            showsHorizontalScrollIndicator={false}
                            onScroll={scrollHandler}
                            scrollEventThrottle={16}
                            onMomentumScrollEnd={onMomentumScrollEnd}
                        >
                            {SLIDES.map((slide, index) => (
                                <SlideItem key={slide.id} slide={slide} index={index} scrollX={scrollX} />
                            ))}
                        </Animated.ScrollView>

                        <View style={styles.footer}>
                            <View style={styles.pagination}>
                                {SLIDES.map((_, index) => (
                                    <PaginationDot key={index} index={index} scrollX={scrollX} />
                                ))}
                            </View>

                            <View style={styles.buttonWrap}>
                                <ScalePress
                                    style={styles.button}
                                    onPress={handleNext}
                                >
                                    <LinearGradient
                                        colors={['#ff6b6b', '#ff8e53']}
                                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                                        style={styles.buttonGrad}
                                    >
                                        <Text style={styles.buttonText}>
                                            {currentIndex === SLIDES.length - 1 ? 'Next: Sign Up' : 'Continue'}
                                        </Text>
                                        <Ionicons
                                            name={currentIndex === SLIDES.length - 1 ? "checkmark-circle" : "arrow-forward"}
                                            size={20}
                                            color="#fff"
                                        />
                                    </LinearGradient>
                                </ScalePress>
                            </View>
                        </View>
                    </>
                )}
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },
    blob: { position: 'absolute', width: 400, height: 400, borderRadius: 200 },

    // Scan & Result Styles
    scanContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', width: SCREEN_WIDTH, paddingTop: 40 },
    skipBtn: { position: 'absolute', top: 50, right: 28, padding: 8, zIndex: 10 },
    skipTxt: { fontFamily: 'DMSans_700Bold', color: '#ff6b6b', fontSize: 17, opacity: 0.8 },
    scanContent: { alignItems: 'center', gap: 40 },
    scannerCircle: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', shadowColor: 'rgba(255,107,107,0.2)', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 1, shadowRadius: 32, elevation: 12 },
    scannerRing: { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 2, borderColor: '#ff6b6b', borderStyle: 'dashed' },
    scanSteps: { alignItems: 'center', gap: 16 },
    scanStepTxt: { fontFamily: 'DMSans_700Bold', fontSize: 18, color: '#9ca3af' },
    scanStepActive: { color: '#1f2937' },
    scanDots: { flexDirection: 'row', gap: 8, marginTop: 10 },
    scanDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e5e7eb' },
    scanDotActive: { backgroundColor: '#ff6b6b' },

    resultContent: { alignItems: 'center', paddingHorizontal: 32, flex: 1, justifyContent: 'space-evenly', paddingVertical: 40 },
    resultTitle: { fontFamily: 'DMSans_700Bold', color: '#6b7280', fontSize: 18, marginBottom: 0 },
    resultAmount: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
    resultAmountText: { fontFamily: 'DMSans_700Bold', color: '#ff6b6b', fontSize: 80, letterSpacing: -2, lineHeight: 80, padding: 0, margin: 0 },
    resultUnit: { fontSize: 24, fontFamily: 'DMSans_700Bold', color: '#ff6b6b', marginLeft: 6, marginBottom: 10 },
    resultSub: { fontFamily: 'DMSans_500Medium', color: '#4b5563', fontSize: 18, marginTop: 20, marginBottom: 10 },

    previewContainer: { width: 200, height: 260, alignItems: 'center', justifyContent: 'center' },
    previewCard: { width: 180, height: 240, backgroundColor: '#ffffff', borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowColor: 'rgba(255,107,107,0.2)', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 24, elevation: 8, zIndex: 2, overflow: 'hidden' },
    previewCardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)' },
    previewCardShadow: { position: 'absolute', width: 180, height: 240, backgroundColor: '#f3f4f6', borderRadius: 24, top: 10, zIndex: 1 },
    previewLabelWrap: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8 },
    previewKeepTxt: { fontFamily: 'DMSans_700Bold', color: '#10b981', fontSize: 24, borderWidth: 3, borderColor: '#10b981', paddingHorizontal: 10, borderRadius: 8 },
    previewDeleteTxt: { fontFamily: 'DMSans_700Bold', color: '#ef4444', fontSize: 24, borderWidth: 3, borderColor: '#ef4444', paddingHorizontal: 10, borderRadius: 8 },
    buttonWrapResult: { width: '85%', position: 'relative', marginTop: 10 },

    // Onboarding Slides Styles
    slide: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, alignItems: 'center', paddingTop: SCREEN_HEIGHT * 0.18, paddingHorizontal: 32 },
    iconContainer: { height: 220, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    circle: { width: 160, height: 160, borderRadius: 80, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff', shadowColor: 'rgba(255,107,107,0.2)', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 1, shadowRadius: 32, elevation: 12, padding: 12 },
    circleInner: { flex: 1, width: '100%', borderRadius: 80, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    textContainer: { alignItems: 'center' },
    title: { fontFamily: 'DMSans_700Bold', fontSize: 34, color: '#1f2937', textAlign: 'center', marginBottom: 16, lineHeight: 42, letterSpacing: -0.5 },
    subtitle: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 26 },

    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 28, paddingBottom: 56 },
    pagination: { flexDirection: 'row', justifyContent: 'center', marginBottom: 36, gap: 8 },
    dot: { height: 8, borderRadius: 4, backgroundColor: '#ff6b6b' },

    buttonWrap: { position: 'relative' },
    button: { borderRadius: 100, overflow: 'hidden', shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
    buttonGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 20, gap: 12 },
    buttonText: { fontFamily: 'DMSans_700Bold', color: '#ffffff', fontSize: 18 },
});
