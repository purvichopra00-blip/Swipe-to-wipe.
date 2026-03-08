import React from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedStyle,
    interpolate,
    Extrapolation,
    SharedValue,
    withSpring,
} from 'react-native-reanimated';
import { Photo } from '../constants/photos';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

interface SwipeCardProps {
    photo: Photo;
    index: number;
    totalVisible: number;
    translateX: SharedValue<number>;
    isTop: boolean;
}

export default function SwipeCard({ photo, index, totalVisible, translateX, isTop }: SwipeCardProps) {

    const cardStyle = useAnimatedStyle(() => {
        if (!isTop) {
            const scale = interpolate(
                Math.abs(translateX.value),
                [0, SWIPE_THRESHOLD],
                [1 - index * 0.04, 1 - (index - 1) * 0.04],
                Extrapolation.CLAMP
            );
            const translateY = interpolate(
                Math.abs(translateX.value),
                [0, SWIPE_THRESHOLD],
                [index * 10, (index - 1) * 10],
                Extrapolation.CLAMP
            );
            return {
                position: 'absolute',
                width: '100%',
                height: '100%',
                zIndex: totalVisible - index,
                transform: [{ scale }, { translateY }],
                opacity: 1, // Photos must be opaque
            };
        }

        // Top card: Rotation and translation
        const rotate = interpolate(
            translateX.value,
            [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
            [-25, 0, 25],
            Extrapolation.CLAMP
        );

        return {
            position: 'absolute',
            width: '100%',
            height: '100%',
            zIndex: totalVisible,
            transform: [
                { translateX: translateX.value },
                { rotate: `${rotate}deg` },
            ],
            opacity: 1, // Guarantee opacity
        };
    });

    // KEEP stamp — only visible when swiping RIGHT (positive X)
    const likeOpacity = useAnimatedStyle(() => {
        if (!isTop || translateX.value <= 0) return { opacity: 0 };
        return {
            opacity: interpolate(
                translateX.value,
                [0, SWIPE_THRESHOLD * 0.4, SWIPE_THRESHOLD],
                [0, 0.7, 1],
                Extrapolation.CLAMP
            ),
        };
    });

    // DELETE stamp — only visible when swiping LEFT (negative X)
    const nopeOpacity = useAnimatedStyle(() => {
        if (!isTop || translateX.value >= 0) return { opacity: 0 };
        return {
            opacity: interpolate(
                translateX.value,
                [0, -SWIPE_THRESHOLD * 0.4, -SWIPE_THRESHOLD],
                [0, 0.7, 1],
                Extrapolation.CLAMP
            ),
        };
    });

    // Swipe threshold bar indicator
    const thresholdBarWidth = useAnimatedStyle(() => {
        if (!isTop) return { width: 0 };
        const w = interpolate(
            Math.abs(translateX.value),
            [0, SWIPE_THRESHOLD],
            [0, 100],
            Extrapolation.CLAMP
        );
        return { width: `${w}%` };
    });

    const thresholdBarColor = useAnimatedStyle(() => {
        if (!isTop) return { backgroundColor: 'transparent' };
        const isRight = translateX.value > 0;
        return { backgroundColor: isRight ? '#22c55e' : '#ef4444' };
    });

    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const formatBytes = (bytes?: number) => {
        if (!bytes) return '';
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <Animated.View style={[styles.card, cardStyle]}>
            <Image
                source={photo.url}
                style={styles.image}
                contentFit="cover"
                transition={150}
            />
            <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']}
                locations={[0.4, 0.7, 1]}
                style={styles.gradient}
            />

            {/* KEEP Stamp */}
            <Animated.View style={[styles.stampBase, styles.keepStampPos, likeOpacity]}>
                <Text style={[styles.stamp, styles.keepStamp]}>KEEP</Text>
            </Animated.View>

            {/* DELETE Stamp */}
            <Animated.View style={[styles.stampBase, styles.deleteStampPos, nopeOpacity]}>
                <Text style={[styles.stamp, styles.deleteStamp]}>DELETE</Text>
            </Animated.View>

            {/* Swipe threshold bar — at bottom of card */}
            {isTop && (
                <View style={styles.thresholdTrack}>
                    <Animated.View style={[styles.thresholdFill, thresholdBarWidth, thresholdBarColor]} />
                </View>
            )}

            {/* Photo info */}
            <View style={styles.infoContainer}>
                <View style={styles.topRow}>
                    <Text style={styles.date} numberOfLines={1}>
                        {new Date(photo.creationTime).toLocaleDateString(undefined, {
                            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                        })}
                    </Text>
                    <View style={styles.metaBadges}>
                        {photo.fileSize ? (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>{formatBytes(photo.fileSize)}</Text>
                            </View>
                        ) : null}
                        {photo.mediaType === 'video' && (
                            <View style={styles.badge}>
                                <Ionicons name="play" size={10} color="#fff" />
                                <Text style={styles.badgeText}>{formatDuration(photo.duration)}</Text>
                            </View>
                        )}
                    </View>
                </View>
                {photo.filename && (
                    <Text style={styles.filename} numberOfLines={1}>{photo.filename}</Text>
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 28,
        backgroundColor: '#ffffff',
        shadowColor: 'rgba(255,107,107,0.15)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 32,
        elevation: 12,
        overflow: 'hidden',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    gradient: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        height: '50%',
    },
    stampBase: {
        position: 'absolute',
        top: 52,
        zIndex: 10,
        borderWidth: 5,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    keepStampPos: {
        left: 36,
        borderColor: '#22c55e',
        transform: [{ rotate: '-15deg' }],
    },
    deleteStampPos: {
        right: 36,
        borderColor: '#ef4444',
        transform: [{ rotate: '15deg' }],
    },
    stamp: {
        fontFamily: 'Syne_800ExtraBold',
        fontSize: 36,
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    keepStamp: {
        color: '#22c55e',
    },
    deleteStamp: {
        color: '#ef4444',
    },
    thresholdTrack: {
        position: 'absolute',
        bottom: 96,
        left: 24,
        right: 24,
        height: 3,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    thresholdFill: {
        height: '100%',
        borderRadius: 2,
    },
    infoContainer: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        padding: 24,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    date: {
        fontFamily: 'Syne_700Bold',
        color: '#fff',
        fontSize: 18,
        letterSpacing: -0.5,
        flex: 1,
    },
    metaBadges: {
        flexDirection: 'row',
        gap: 6,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        gap: 4,
    },
    badgeText: {
        fontFamily: 'DMSans_700Bold',
        color: '#fff',
        fontSize: 12,
    },
    filename: {
        fontFamily: 'DMSans_500Medium',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 13,
    },
});
