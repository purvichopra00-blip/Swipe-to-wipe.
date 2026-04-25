import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
    StyleSheet, View, Text, Dimensions,
    NativeSyntheticEvent, NativeScrollEvent, Pressable, StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedScrollHandler, useSharedValue, useAnimatedStyle,
    interpolate, Extrapolation, withSpring, SharedValue,
    interpolateColor, withSequence, withDelay, withTiming, withRepeat, runOnJS
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { logEvent, TrackEvents } from '../lib/analytics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const ONBOARDING_COMPLETED_KEY = '@onboarding_completed_v4';
const PERMISSIONS_GRANTED_KEY = '@permissions_granted_v1';

const SLIDES = [
    {
        id: '1',
        title: 'Your gallery\nis a mess.',
        description: 'Let’s fix it in 2 minutes.',
        variant: 'hook' as const,
        icon: 'images' as const,
    },
    {
        id: '2',
        title: 'Swipe. Done.',
        description: 'Right = keep\nLeft = delete',
        variant: 'mechanic' as const,
        icon: 'swap-horizontal' as const,
    },
    {
        id: '3',
        title: 'Free up GBs\ninstantly.',
        description: 'Most people delete 2,000+ photos.\nEverything stays on your device.',
        variant: 'value' as const,
        icon: 'flash' as const,
    },
    {
        id: '4',
        title: '100% Private.',
        description: 'Nothing leaves your phone.',
        variant: 'trust' as const,
        icon: 'shield-checkmark' as const,
    },
];

// ─── Animated Demo Card (for Mechanic Slide) ──────────────────────────────────
const DemoCard = () => {
    const translateX = useSharedValue(0);
    const rotate = useSharedValue(0);
    const opacity = useSharedValue(1);
    const [imgIndex, setImgIndex] = useState(0);

    const IMAGES = [
        "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80",
        "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
        "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80",
        "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=400&q=80",
        "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=400&q=80",
    ];

    // Ghost hand values
    const handX = useSharedValue(0);
    const handOpacity = useSharedValue(0);
    const handScale = useSharedValue(1.5);

    useEffect(() => {
        const DISTANCE = 120;
        const SWIPE_SPEED = { damping: 12, stiffness: 150 };
        const HOLD = 350;
        const RESET_WAIT = 150;

        translateX.value = withRepeat(
            withSequence(
                // Swipe Right (Keep)
                withDelay(HOLD, withSpring(DISTANCE, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }, () => {
                    runOnJS(setImgIndex)((prev: number) => (prev + 1) % IMAGES.length);
                })),
                // Swipe Left (Delete)
                withDelay(HOLD, withSpring(-DISTANCE, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }, () => {
                    runOnJS(setImgIndex)((prev: number) => (prev + 1) % IMAGES.length);
                }))
            ),
            -1,
            false
        );

        rotate.value = withRepeat(
            withSequence(
                withDelay(HOLD, withSpring(15, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 })),
                withDelay(HOLD, withSpring(-15, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }))
            ),
            -1,
            false
        );

        handX.value = withRepeat(
            withSequence(
                withDelay(HOLD, withSpring(DISTANCE, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 })),
                withDelay(HOLD, withSpring(-DISTANCE, SWIPE_SPEED)),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }))
            ),
            -1,
            false
        );

        handOpacity.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 200 }), // Appear
                withDelay(HOLD + 200, withTiming(0, { duration: 200 })), // Stay through swipe then fade
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 })),
                withTiming(1, { duration: 200 }),
                withDelay(HOLD + 200, withTiming(0, { duration: 200 })),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }))
            ),
            -1,
            false
        );

        handScale.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 200 }), // "Press"
                withDelay(HOLD + 200, withTiming(1.2, { duration: 100 })), // "Lift"
                withDelay(RESET_WAIT, withTiming(1.5, { duration: 0 })),
                withTiming(1, { duration: 200 }),
                withDelay(HOLD + 200, withTiming(1.2, { duration: 100 })),
                withDelay(RESET_WAIT, withTiming(1.5, { duration: 0 }))
            ),
            -1,
            false
        );

        opacity.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 0 }),
                withDelay(HOLD + 200, withTiming(0, { duration: 200 })), // Fade out as it finishes swipe
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 })),
                withTiming(1, { duration: 0 }),
                withDelay(HOLD + 200, withTiming(0, { duration: 200 })),
                withDelay(RESET_WAIT, withTiming(0, { duration: 0 }))
            ),
            -1,
            false
        );
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { rotate: `${rotate.value}deg` }
        ],
        opacity: opacity.value
    }));

    const handAnimatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: handX.value },
            { scale: handScale.value },
            { translateY: 40 }
        ],
        opacity: handOpacity.value
    }));

    const keepOpacity = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, 40], [0, 1], Extrapolation.CLAMP)
    }));

    const deleteOpacity = useAnimatedStyle(() => ({
        opacity: interpolate(translateX.value, [0, -40], [0, 1], Extrapolation.CLAMP)
    }));

    return (
        <View style={styles.demoContainer}>
            {/* Background stack */}
            <View style={[styles.demoCard, { position: 'absolute', transform: [{ scale: 0.9 }, { translateY: -15 }], zIndex: 1 }]}>
                <Image source={{ uri: IMAGES[(imgIndex + 2) % IMAGES.length] }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </View>
            <View style={[styles.demoCard, { position: 'absolute', transform: [{ scale: 0.95 }, { translateY: -8 }], zIndex: 2 }]}>
                <Image source={{ uri: IMAGES[(imgIndex + 1) % IMAGES.length] }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </View>

            {/* Top animating card */}
            <Animated.View style={[styles.demoCard, animatedStyle, { zIndex: 3, overflow: 'hidden' }]}>
                <Image
                    source={{ uri: IMAGES[imgIndex] }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                />
                
                {/* Embedded Overlays */}
                <Animated.View style={[styles.demoStampBase, styles.demoKeepStampPos, keepOpacity]}>
                    <Text style={[styles.demoStamp, styles.demoKeepStamp]}>KEEP</Text>
                </Animated.View>
                <Animated.View style={[styles.demoStampBase, styles.demoDeleteStampPos, deleteOpacity]}>
                    <Text style={[styles.demoStamp, styles.demoDeleteStamp]}>DELETE</Text>
                </Animated.View>

                <View style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="images" size={16} color="#FF6B6B" />
                </View>
            </Animated.View>

            {/* Ghost Hand Indicator */}
            <Animated.View style={[styles.ghostHand, handAnimatedStyle]}>
                <View style={styles.ghostGlow} />
            </Animated.View>
        </View>
    );
};

// ─── Slide Component ────────────────────────────────────────────────────────────
const SlideItem = ({ slide, index, scrollX }: { slide: typeof SLIDES[0], index: number, scrollX: SharedValue<number> }) => {
    const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];

    const contentStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
        transform: [{
            translateY: interpolate(scrollX.value, inputRange, [15, 0, -15], Extrapolation.CLAMP)
        }],
    }));

    return (
        <View style={styles.slide}>
            <Animated.View style={[styles.contentContainer, contentStyle]}>
                {slide.variant === 'mechanic' ? (
                    <DemoCard />
                ) : (
                    <View style={styles.iconWrap}>
                        <Ionicons name={slide.icon} size={slide.variant === 'hook' ? 72 : 60} color="#FF6B6B" />
                    </View>
                )}

                <Text style={styles.slideTitle}>{slide.title}</Text>
                <Text style={styles.slideSubtitle}>{slide.description}</Text>
            </Animated.View>
        </View>
    );
};

// ─── Pagination Dot ─────────────────────────────────────────────────────────────
const Dot = ({ index, scrollX }: { index: number, scrollX: SharedValue<number> }) => {
    const style = useAnimatedStyle(() => ({
        width: interpolate(
            scrollX.value,
            [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH],
            [6, 18, 6], Extrapolation.CLAMP
        ),
        backgroundColor: interpolateColor(
            scrollX.value,
            [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH],
            ['#E5E5EA', '#FF6B6B', '#E5E5EA']
        ),
    }));
    return <Animated.View style={[styles.dot, style]} />;
};

// ─── Scale-Press Button ─────────────────────────────────────────────────────────
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
function ScalePress({ children, onPress, style }: { children: React.ReactNode, onPress?: () => void, style?: any }) {
    const scale = useSharedValue(1);
    const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
    return (
        <AnimatedPressable
            onPress={onPress}
            onPressIn={() => { scale.value = withSpring(0.96, { damping: 12, stiffness: 300 }); }}
            onPressOut={() => { scale.value = withSpring(1, { damping: 12, stiffness: 300 }); }}
            style={[style, animStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

// ─── Main Screen ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
    const router = useRouter();
    const scrollRef = useRef<Animated.ScrollView>(null);
    const scrollX = useSharedValue(0);
    const [currentIndex, setCurrentIndex] = useState(0);
    const isLastSlide = currentIndex === SLIDES.length - 1;

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (e) => { scrollX.value = e.contentOffset.x; },
    });

    const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
        if (idx !== currentIndex) {
            setCurrentIndex(idx);
            Haptics.selectionAsync();
        }
    };

    const handleNext = useCallback(async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        if (!isLastSlide) {
            scrollRef.current?.scrollTo({ x: (currentIndex + 1) * SCREEN_WIDTH, animated: true });
            return;
        }

        await AsyncStorage.multiSet([
            [ONBOARDING_COMPLETED_KEY, 'true'],
            ['@auth_token_v1', 'guest'],
        ]);
        logEvent(TrackEvents.ONBOARDING_COMPLETE);
        router.replace('/permissions');
    }, [currentIndex, isLastSlide, router]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />

            <Animated.ScrollView
                ref={scrollRef as any}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                onMomentumScrollEnd={onMomentumScrollEnd}
                style={{ flex: 1 }}
            >
                {SLIDES.map((slide, i) => (
                    <SlideItem key={slide.id} slide={slide} index={i} scrollX={scrollX} />
                ))}
            </Animated.ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
                <View style={styles.pagination}>
                    {SLIDES.map((_, i) => (
                        <Dot key={i} index={i} scrollX={scrollX} />
                    ))}
                </View>

                <ScalePress style={styles.btnWrap} onPress={handleNext}>
                    <View style={styles.btnContent}>
                        <Text style={styles.btnText}>
                            {isLastSlide ? "Start Now →" : 'Continue'}
                        </Text>
                    </View>
                </ScalePress>
            </View>
        </View>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FAFAFA' },

    slide: {
        width: SCREEN_WIDTH,
        alignItems: 'center',
        paddingHorizontal: 40,
        justifyContent: 'center',
    },
    contentContainer: {
        alignItems: 'center',
        width: '100%',
    },
    iconWrap: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: '#FFF1F1',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40,
    },
    slideTitle: {
        fontFamily: 'System',
        fontSize: 36,
        color: '#1C1C1E',
        textAlign: 'center',
        lineHeight: 44,
        letterSpacing: -1.2,
        marginBottom: 12,
        fontWeight: '800',
    },
    slideSubtitle: {
        fontFamily: 'System',
        fontSize: 18,
        color: '#6B7280',
        textAlign: 'center',
        lineHeight: 26,
        fontWeight: '500',
    },

    // Demo Card Styles
    demoContainer: {
        width: 200,
        height: 240,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 40,
    },
    demoCard: {
        width: 140,
        height: 180,
        borderRadius: 20,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 5,
        borderWidth: 1,
        borderColor: '#EDEDED',
    },
    demoStampBase: {
        position: 'absolute',
        top: 20,
        zIndex: 10,
        borderWidth: 3,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: 'rgba(255,255,255,0.8)',
    },
    demoKeepStampPos: {
        left: 10,
        borderColor: '#22C55E',
        transform: [{ rotate: '-15deg' }],
    },
    demoDeleteStampPos: {
        right: 10,
        borderColor: '#FF3B30',
        transform: [{ rotate: '15deg' }],
    },
    demoStamp: {
        fontFamily: 'System',
        fontWeight: '900',
        fontSize: 16,
        letterSpacing: 1,
    },
    demoKeepStamp: { color: '#22C55E' },
    demoDeleteStamp: { color: '#FF3B30' },

    ghostHand: {
        position: 'absolute',
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.9)',
        zIndex: 20,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
    ghostGlow: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
    },

    footer: {
        paddingHorizontal: 32,
        paddingBottom: 60,
    },
    pagination: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
        marginBottom: 32,
    },
    dot: {
        height: 6,
        borderRadius: 3,
    },

    btnWrap: {
        borderRadius: 18,
        backgroundColor: '#FF6B6B',
        overflow: 'hidden',
        shadowColor: '#FF6B6B',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 8,
    },
    btnContent: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
    },
    btnText: {
        fontFamily: 'System',
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
    },
});
