import React, { useState, useEffect, memo } from 'react';
import { StyleSheet, View, Text, Dimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    useAnimatedStyle,
    interpolate,
    Extrapolation,
    SharedValue,
    useSharedValue,
} from 'react-native-reanimated';
import { Photo } from '../constants/photos';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

interface SwipeCardProps {
    photo: Photo;
    index: number;
    totalVisible: number;
    translateX: SharedValue<number>;
    translateY?: SharedValue<number>;
    isTop: boolean;
}

const SwipeCard = memo(({ photo, index, totalVisible, translateX, translateY, isTop }: SwipeCardProps) => {
    const fallbackY = useSharedValue(0);
    const safeTranslateY = translateY ?? fallbackY;
    const [resolvedVideoUri, setResolvedVideoUri] = useState<string | null>(null);
    
    const player = useVideoPlayer(photo.mediaType === 'video' ? (resolvedVideoUri || photo.url) : null, (p) => {
        p.loop = true;
        p.muted = true;
    });

    useEffect(() => {
        if (photo.mediaType === 'video' && !resolvedVideoUri) {
            MediaLibrary.getAssetInfoAsync(photo.id).then(info => {
                setResolvedVideoUri(info.localUri || info.uri);
            }).catch(err => {
                console.warn('Failed to resolve video URI:', err);
            });
        }
    }, [photo.id, photo.mediaType]);

    useEffect(() => {
        if (isTop && photo.mediaType === 'video') {
            player.play();
        } else {
            player.pause();
        }
    }, [isTop, player, photo.mediaType]);

    // 1. Optimized Animation: Only animate the top card
    const cardStyle = useAnimatedStyle(() => {
        if (!isTop) {
            // Background cards: Animate forward seamlessly as top card is swiped
            const progress = interpolate(
                Math.abs(translateX.value),
                [0, SWIPE_THRESHOLD],
                [0, 1],
                Extrapolation.CLAMP
            );

            const currentScale = 1 - index * 0.06;
            const nextScale = 1 - (index - 1) * 0.06;
            const scale = interpolate(progress, [0, 1], [currentScale, nextScale], Extrapolation.CLAMP);

            const currentYDepth = index * -15; // Negative Y puts it slightly higher like a physical stack
            const nextYDepth = (index - 1) * -15;
            const transY = interpolate(progress, [0, 1], [currentYDepth, nextYDepth], Extrapolation.CLAMP);

            return {
                transform: [
                    { scale },
                    { translateY: transY }
                ],
                zIndex: totalVisible - index,
                opacity: 1 // Only needed if you want deep cards to fade in, but solid stack looks better
            };
        }

        // Top card: Rotation and translation
        const rotate = interpolate(
            translateX.value,
            [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
            [-8, 0, 8], // slightly more rotation for a more fluid feel
            Extrapolation.CLAMP
        );

        const currentY = safeTranslateY.value;

        return {
            zIndex: totalVisible,
            transformOrigin: 'bottom center',
            transform: [
                { translateX: translateX.value },
                { translateY: currentY },
                { rotate: `${rotate}deg` },
            ],
        };
    });

    // KEEP stamp — only visible when swiping RIGHT (positive X)
    const likeOpacity = useAnimatedStyle(() => {
        if (!isTop || translateX.value <= 0) return { opacity: 0, transform: [{ scale: 0.8 }] };
        const opacity = interpolate(
            translateX.value,
            [0, SWIPE_THRESHOLD * 0.4, SWIPE_THRESHOLD],
            [0, 0.7, 1],
            Extrapolation.CLAMP
        );
        const scale = interpolate(
            translateX.value,
            [0, SWIPE_THRESHOLD * 0.4, SWIPE_THRESHOLD],
            [1.4, 1.1, 1],
            Extrapolation.CLAMP
        );
        return { opacity, transform: [{ scale }] };
    });

    // DELETE stamp — only visible when swiping LEFT (negative X)
    const nopeOpacity = useAnimatedStyle(() => {
        if (!isTop || translateX.value >= 0) return { opacity: 0, transform: [{ scale: 0.8 }] };
        const opacity = interpolate(
            translateX.value,
            [0, -SWIPE_THRESHOLD * 0.4, -SWIPE_THRESHOLD],
            [0, 0.7, 1],
            Extrapolation.CLAMP
        );
        const scale = interpolate(
            translateX.value,
            [0, -SWIPE_THRESHOLD * 0.4, -SWIPE_THRESHOLD],
            [1.4, 1.1, 1],
            Extrapolation.CLAMP
        );
        return { opacity, transform: [{ scale }] };
    });

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '0:00';
        const totalSeconds = Math.floor(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    const formatBytes = (bytes?: number) => {
        if (!bytes) return '';
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <Animated.View style={[styles.shadowWrapper, cardStyle]}>
            <View style={styles.card}>
                {photo.mediaType === 'video' ? (
                    <VideoView
                        player={player}
                        style={styles.image}
                        contentFit="cover"
                        nativeControls={false}
                    />
                ) : (
                    <Image
                        source={{ uri: photo.url }}
                        style={styles.image}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={photo.id}
                        transition={0}
                        placeholder={{ blurhash: 'L05#_6~qj[fQj[fQj[fQj[fQj[fQ' }}
                    />
                )}
                
                {/* 5. LinearGradient optimized with pointerEvents="none" */}
                <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']}
                    locations={[0.4, 0.7, 1]}
                    style={styles.gradient}
                    pointerEvents="none"
                />

                {/* KEEP Stamp */}
                <Animated.View style={[styles.stampBase, styles.keepStampPos, likeOpacity]} pointerEvents="none">
                    <Text style={[styles.stamp, styles.keepStamp]}>KEEP</Text>
                </Animated.View>

                {/* DELETE Stamp */}
                <Animated.View style={[styles.stampBase, styles.deleteStampPos, nopeOpacity]} pointerEvents="none">
                    <Text style={[styles.stamp, styles.deleteStamp]}>DELETE</Text>
                </Animated.View>

                {/* Photo info */}
                <View style={styles.infoContainer} pointerEvents="none">
                    <View style={styles.topRow}>
                        <Text style={styles.date} numberOfLines={1}>
                            {new Date(photo.creationTime || Date.now()).toLocaleDateString(undefined, {
                                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                            })}
                        </Text>
                        <View style={styles.metaBadges}>
                            {!!photo.fileSize && (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{formatBytes(photo.fileSize)}</Text>
                                </View>
                            )}
                            {!!(photo as any).duration && (
                                <View style={styles.badge}>
                                    <Ionicons name="play" size={10} color="#fff" />
                                    <Text style={styles.badgeText}>{formatDuration((photo as any).duration)}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                    {!!photo.filename && (
                        <Text style={styles.filename} numberOfLines={1}>{photo.filename}</Text>
                    )}
                </View>
            </View>
        </Animated.View>
    );
}, (prevProps, nextProps) => {
    // 2. Custom memo comparison for extreme performance
    return (
        prevProps.photo.id === nextProps.photo.id &&
        prevProps.isTop === nextProps.isTop &&
        prevProps.index === nextProps.index
    );
});

const styles = StyleSheet.create({
    shadowWrapper: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        // 3. Move shadows to wrapper View
        shadowColor: 'rgba(0,0,0,0.12)',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 10,
        backgroundColor: 'transparent',
    },
    card: {
        flex: 1,
        borderRadius: 28,
        backgroundColor: '#ffffff',
        // 3. Ensure card itself only has borderRadius + overflow
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

export default SwipeCard;
