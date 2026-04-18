import React, { useRef, useState, useCallback } from 'react';
import {
    StyleSheet, View, Text, Dimensions,
    NativeSyntheticEvent, NativeScrollEvent, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedScrollHandler, useSharedValue, useAnimatedStyle,
    interpolate, Extrapolation, withSpring, SharedValue
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { logEvent, TrackEvents } from '../lib/analytics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export const ONBOARDING_COMPLETED_KEY = '@onboarding_completed_v4';
const PERMISSIONS_GRANTED_KEY = '@permissions_granted_v1';

// ─── Slide Data ────────────────────────────────────────────────────────────────
const SLIDES = [
    {
        id: '1',
        title: 'Your gallery is\ncluttered.',
        description: 'Thousands of forgotten photos, screenshots and old memes eating your storage.',
        icon: 'images-outline' as const,
        colors: ['#ff8e53', '#ff6b6b'] as [string, string],
    },
    {
        id: '2',
        title: 'Swipe to clean\nin minutes.',
        description: 'Swipe right to keep. Swipe left to Review Bin. Nothing gets permanently deleted while you swipe.',
        icon: 'swap-horizontal-outline' as const,
        colors: ['#ff6b6b', '#f43f5e'] as [string, string],
    },
    {
        id: '3',
        title: 'Your photos never\nleave your device.',
        description: 'Everything is processed locally on your phone. No photos are uploaded or stored on any server. Ever.',
        icon: 'shield-checkmark-outline' as const,
        colors: ['#a78bfa', '#6366f1'] as [string, string],
    },
];

// ─── Slide Component ────────────────────────────────────────────────────────────
const SlideItem = ({ slide, index, scrollX }: { slide: typeof SLIDES[0], index: number, scrollX: SharedValue<number> }) => {
    const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];

    const textStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
        transform: [{
            translateY: interpolate(scrollX.value, inputRange, [40, 0, -40], Extrapolation.CLAMP)
        }],
    }));

    const iconStyle = useAnimatedStyle(() => ({
        transform: [{
            scale: interpolate(scrollX.value, inputRange, [0.75, 1, 0.75], Extrapolation.CLAMP)
        }],
    }));

    return (
        <View style={styles.slide}>
            {/* Icon */}
            <Animated.View style={[styles.iconWrap, iconStyle]}>
                <LinearGradient colors={slide.colors} style={StyleSheet.absoluteFillObject} />
                <Ionicons name={slide.icon} size={68} color="#fff" />
            </Animated.View>

            {/* Text */}
            <Animated.View style={[styles.textBlock, textStyle]}>
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
            [8, 26, 8], Extrapolation.CLAMP
        ),
        opacity: interpolate(
            scrollX.value,
            [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH],
            [0.3, 1, 0.3], Extrapolation.CLAMP
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
            onPressIn={() => { scale.value = withSpring(0.94, { damping: 10, stiffness: 400 }); }}
            onPressOut={() => { scale.value = withSpring(1, { damping: 10, stiffness: 400 }); }}
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
            // Go to next slide
            scrollRef.current?.scrollTo({ x: (currentIndex + 1) * SCREEN_WIDTH, animated: true });
            return;
        }

        // Last slide: request permissions, then go to swipe screen
        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status === 'granted') {
                await AsyncStorage.multiSet([
                    [ONBOARDING_COMPLETED_KEY, 'true'],
                    [PERMISSIONS_GRANTED_KEY, 'true'],
                    // Guest mode is the default — no login required
                    ['@auth_token_v1', 'guest'],
                ]);
                logEvent(TrackEvents.ONBOARDING_COMPLETE);
                router.replace('/(tabs)');
            } else {
                // Permission denied — still complete onboarding, go to swipe (it will prompt again)
                await AsyncStorage.multiSet([
                    [ONBOARDING_COMPLETED_KEY, 'true'],
                    ['@auth_token_v1', 'guest'],
                ]);
                logEvent(TrackEvents.ONBOARDING_COMPLETE);
                router.replace('/(tabs)');
            }
        } catch {
            // Fallback: always proceed
            await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
            router.replace('/(tabs)');
        }
    }, [currentIndex, isLastSlide, router]);

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            <LinearGradient colors={['#fff5f7', '#ffffff']} style={StyleSheet.absoluteFillObject} />

            {/* Decorative blobs */}
            <View style={[styles.blob, { top: -180, left: -80, backgroundColor: 'rgba(255,107,107,0.05)' }]} />
            <View style={[styles.blob, { bottom: -200, right: -100, backgroundColor: 'rgba(255,142,83,0.05)' }]} />

            {/* Slides */}
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
                {/* Pagination dots */}
                <View style={styles.pagination}>
                    {SLIDES.map((_, i) => (
                        <Dot key={i} index={i} scrollX={scrollX} />
                    ))}
                </View>

                {/* CTA Button */}
                <ScalePress style={styles.btnWrap} onPress={handleNext}>
                    <LinearGradient
                        colors={['#ff6b6b', '#ff8e53']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.btnGrad}
                    >
                        <Text style={styles.btnText}>
                            {isLastSlide ? "Get Started — It's Free" : 'Continue'}
                        </Text>
                        <Ionicons
                            name={isLastSlide ? 'checkmark-circle' : 'arrow-forward'}
                            size={20}
                            color="#fff"
                        />
                    </LinearGradient>
                </ScalePress>

                {/* Tiny privacy note on last screen */}
                {isLastSlide && (
                    <Text style={styles.privacyNote}>
                        We'll ask for photo access on the next step.
                    </Text>
                )}
            </View>
        </SafeAreaView>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff5f7' },
    blob: { position: 'absolute', width: 380, height: 380, borderRadius: 190 },

    // Slide
    slide: {
        width: SCREEN_WIDTH,
        minHeight: SCREEN_HEIGHT * 0.72,
        alignItems: 'center',
        paddingTop: SCREEN_HEIGHT * 0.1,
        paddingHorizontal: 36,
    },
    iconWrap: {
        width: 148,
        height: 148,
        borderRadius: 74,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 44,
        overflow: 'hidden',
        shadowColor: '#ff6b6b',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.22,
        shadowRadius: 28,
        elevation: 12,
    },
    textBlock: { alignItems: 'center' },
    slideTitle: {
        fontFamily: 'Syne_700Bold',
        fontSize: 34,
        color: '#1f2937',
        textAlign: 'center',
        lineHeight: 43,
        letterSpacing: -0.5,
        marginBottom: 18,
    },
    slideSubtitle: {
        fontFamily: 'DMSans_500Medium',
        fontSize: 17,
        color: '#6b7280',
        textAlign: 'center',
        lineHeight: 27,
    },

    // Footer
    footer: {
        paddingHorizontal: 28,
        paddingBottom: 40,
        paddingTop: 12,
    },
    pagination: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 32,
    },
    dot: {
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ff6b6b',
    },

    // Button
    btnWrap: {
        borderRadius: 100,
        overflow: 'hidden',
        shadowColor: '#ff6b6b',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
        elevation: 10,
    },
    btnGrad: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        gap: 12,
    },
    btnText: {
        fontFamily: 'DMSans_700Bold',
        color: '#ffffff',
        fontSize: 18,
        letterSpacing: 0.1,
    },

    // Privacy note
    privacyNote: {
        fontFamily: 'DMSans_400Regular',
        color: '#9ca3af',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 14,
    },
});
