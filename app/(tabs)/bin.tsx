import React, { useCallback, useState } from 'react';
import {
    StyleSheet, View, Text, Pressable, Alert,
    ActivityIndicator, FlatList, Dimensions, StatusBar,
    Modal, Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { usePhotos } from '../../contexts/PhotoContext';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { BinPhoto } from '../../contexts/PhotoContext';
import ConfettiCannon from 'react-native-confetti-cannon';
import { Easing } from 'react-native-reanimated';
import Animated, { Layout, FadeIn, FadeOut, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_TOKEN_KEY } from '../(auth)/login';

const { width: W } = Dimensions.get('window');
const COL = 3;
const ITEM = (W - 32 - (COL - 1) * 3) / COL;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

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

export default function BinScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { binPhotos, commitDeletions, restoreFromBin, binStorageBytes, totalClearedBytes } = usePhotos();
    const [isDeleting, setIsDeleting] = useState(false);

    // Celebration state
    const [deletedStats, setDeletedStats] = useState({ count: 0, bytes: 0, show: false });
    const celebScale = React.useRef(new RNAnimated.Value(0.8)).current;
    const celebOpacity = React.useRef(new RNAnimated.Value(0)).current;
    const orbitSpin = React.useRef(new RNAnimated.Value(0)).current;

    // Start orbit animation loop
    React.useEffect(() => {
        RNAnimated.loop(
            RNAnimated.timing(orbitSpin, {
                toValue: 1, duration: 4000, easing: Easing.linear as any, useNativeDriver: true
            })
        ).start();
    }, []);

    const showCelebration = (count: number, bytes: number) => {
        setDeletedStats({ count, bytes, show: true });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        RNAnimated.parallel([
            RNAnimated.spring(celebScale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
            RNAnimated.timing(celebOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start();
    };

    const closeCelebration = () => {
        RNAnimated.parallel([
            RNAnimated.timing(celebScale, { toValue: 0.9, duration: 150, useNativeDriver: true }),
            RNAnimated.timing(celebOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        ]).start(() => setDeletedStats(s => ({ ...s, show: false })));
    };

    const fmt = (b: number) => {
        if (!b) return '0 B';
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
        if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
        return `${(b / 1024 ** 3).toFixed(2)} GB`;
    };

    const daysLeft = (d: number) => Math.max(0, Math.ceil((SEVEN_DAYS - (Date.now() - d)) / 86400000));

    const handleDeleteAll = useCallback(() => {
        Alert.alert(
            'Delete All Permanently?',
            `Remove all ${binPhotos.length} items from your device. This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete All', style: 'destructive',
                    onPress: async () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        setIsDeleting(true);
                        const count = binPhotos.length;
                        const bytes = binStorageBytes;
                        await commitDeletions();
                        setIsDeleting(false);
                        showCelebration(count, bytes);
                    },
                },
            ]
        );
    }, [binPhotos.length, commitDeletions]);

    const handleRestore = useCallback(async (photo: BinPhoto) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await restoreFromBin(photo.id);
    }, [restoreFromBin]);

    const handleDeleteOne = useCallback((photo: BinPhoto) => {
        Alert.alert('Delete Permanently?', photo.filename, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    setIsDeleting(true);
                    const bytes = photo.fileSize || 0;
                    await commitDeletions([photo.id]);
                    setIsDeleting(false);
                    showCelebration(1, bytes);
                },
            },
        ]);
    }, [commitDeletions]);

    const renderItem = ({ item }: { item: BinPhoto }) => {
        const days = daysLeft(item.deletedAt);
        const urgent = days <= 1;
        return (
            <Animated.View
                layout={Layout.springify().damping(20).stiffness(150)}
                entering={FadeIn.duration(400)}
                exiting={FadeOut.duration(300)}
                style={styles.gridItemWrap}
            >
                <Pressable
                    style={styles.gridItem}
                    onLongPress={() => handleDeleteOne(item)}
                    onPress={() => handleRestore(item)}
                >
                    <Image source={item.url} style={styles.thumb} contentFit="cover" />
                    {/* Gradient overlay */}
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.thumbGrad} />
                    {/* Days badge */}
                    <View style={[styles.daysBadge, urgent && styles.daysBadgeRed]}>
                        <Text style={[styles.daysTxt, urgent && { color: '#fff' }]}>{days}d</Text>
                    </View>
                </Pressable>
            </Animated.View>
        );
    };

    const EmptyState = () => (
        <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
                <Ionicons name="trash-outline" size={52} color="rgba(255,255,255,0.15)" />
            </View>
            <Text style={styles.emptyTitle}>Review Bin is Empty</Text>
            <Text style={styles.emptySub}>Items you swipe left will appear here for 7 days before being permanently deleted.</Text>
        </View>
    );

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <LinearGradient colors={['#fff0f5', '#ffffff', '#fff0f5']} style={StyleSheet.absoluteFill} />

            {/* Header */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 24) }]}>
                <View>
                    <Text style={styles.title}>Review Bin</Text>
                    <Text style={styles.subtitle}>
                        {binPhotos.length > 0
                            ? `${binPhotos.length} items · ${fmt(binStorageBytes)} to free`
                            : 'Nothing staged for deletion'}
                    </Text>
                </View>

                {binPhotos.length > 0 ? (
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <Pressable
                            onPress={async () => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
                                router.replace('/login');
                            }}
                            style={[styles.headerIconBtn, { backgroundColor: 'rgba(99,102,241,0.08)' }]}
                        >
                            <Ionicons name="log-out-outline" size={20} color="#6366f1" />
                        </Pressable>
                        <ScalePress style={styles.deleteAllBtn} onPress={handleDeleteAll} disabled={isDeleting}>
                            {isDeleting
                                ? <ActivityIndicator size="small" color="#ef4444" />
                                : <>
                                    <Ionicons name="trash" size={16} color="#ef4444" />
                                    <Text style={styles.deleteAllTxt}>Delete All</Text>
                                </>
                            }
                        </ScalePress>
                    </View>
                ) : (
                    <Pressable
                        onPress={async () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
                            router.replace('/login');
                        }}
                        style={[styles.headerIconBtn, { backgroundColor: 'rgba(99,102,241,0.08)' }]}
                    >
                        <Ionicons name="log-out-outline" size={20} color="#6366f1" />
                    </Pressable>
                )}
            </View>

            {/* Storage freed pill */}
            {binPhotos.length > 0 ? (
                <View style={styles.storagePill}>
                    <Ionicons name="sparkles-outline" size={14} color="#a78bfa" />
                    <Text style={styles.storagePillTxt}>
                        Free up <Text style={{ color: '#a78bfa', fontWeight: '800' }}>{fmt(binStorageBytes)}</Text> by deleting all
                    </Text>
                </View>
            ) : null}

            {/* Hint */}
            {binPhotos.length > 0 ? (
                <Text style={styles.hint}>Tap to restore · Long press to delete permanently</Text>
            ) : null}

            {/* Total Cleared Stats */}
            <View style={styles.totalStatsCard}>
                <View style={styles.totalStatsLeft}>
                    <View style={styles.totalStatsIconWrap}>
                        <Ionicons name="shield-checkmark" size={20} color="#6366f1" />
                    </View>
                    <View>
                        <Text style={styles.totalStatsLbl}>Total Space Freed</Text>
                        <Text style={styles.totalStatsVal}>{fmt(totalClearedBytes)}</Text>
                    </View>
                </View>
                <View style={styles.totalStatsRight}>
                    <Text style={styles.totalStatsHint}>Lifetime</Text>
                </View>
            </View>

            {/* Grid */}
            <FlatList
                data={binPhotos}
                renderItem={renderItem}
                keyExtractor={item => item.id}
                numColumns={3}
                contentContainerStyle={[
                    styles.grid,
                    { paddingBottom: Math.max(insets.bottom, 24) + 160 },
                    binPhotos.length === 0 && { flex: 1, justifyContent: 'center', paddingBottom: 0 },
                ]}
                ListEmptyComponent={<EmptyState />}
                showsVerticalScrollIndicator={false}
                columnWrapperStyle={binPhotos.length > 0 ? styles.row : undefined}
            />

            {/* Recover All button at bottom if items exist */}
            {binPhotos.length > 0 ? (
                <View style={[styles.footer, { bottom: Math.max(insets.bottom, 24) + 90 }]}>
                    <ScalePress
                        style={styles.recoverBtn}
                        onPress={async () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            for (const p of binPhotos) await restoreFromBin(p.id);
                        }}
                    >
                        <Ionicons name="arrow-undo" size={16} color="#ff6b6b" />
                        <Text style={styles.recoverTxt}>Recover All</Text>
                    </ScalePress>

                    <ScalePress
                        style={styles.permDeleteBtn}
                        onPress={handleDeleteAll}
                        disabled={isDeleting}
                    >
                        <LinearGradient colors={['rgba(239,68,68,0.2)', 'rgba(239,68,68,0.1)']}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.permDeleteGrad}>
                            <Ionicons name="trash-outline" size={16} color="#ef4444" />
                            <Text style={styles.permDeleteTxt}>Delete Permanently</Text>
                        </LinearGradient>
                    </ScalePress>
                </View>
            ) : null}

            {/* Permanent Deletion Celebration Popup */}
            <Modal visible={deletedStats.show} transparent animationType="none" onRequestClose={closeCelebration}>
                <Pressable style={styles.celebOverlay} onPress={closeCelebration}>
                    <RNAnimated.View
                        style={[styles.celebCard, {
                            opacity: celebOpacity,
                            transform: [{ scale: celebScale }],
                        }]}
                    >
                        <LinearGradient colors={['rgba(255,107,107,0.08)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
                        {/* Shimmer line top */}
                        <View style={styles.celebShimmer} />

                        {deletedStats.show && (
                            <ConfettiCannon
                                count={60}
                                origin={{ x: W / 2, y: -20 }}
                                fallSpeed={2500}
                                fadeOut
                                colors={['#ef4444', '#dc2626', '#f87171', '#fcd34d']}
                            />
                        )}

                        <View style={styles.celebIconWrap}>
                            <Ionicons name="trash-bin" size={36} color="#ef4444" />
                            {/* Orbiting dot */}
                            <RNAnimated.View style={[styles.orbitContainer, {
                                transform: [{
                                    rotate: orbitSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
                                }]
                            }]}>
                                <View style={styles.orbitDot} />
                            </RNAnimated.View>
                        </View>

                        <Text style={styles.celebTitle}>
                            {deletedStats.count} {deletedStats.count === 1 ? 'Item' : 'Items'} Permanently Deleted
                        </Text>

                        {deletedStats.bytes > 0 ? (
                            <View style={styles.celebStorage}>
                                <Text style={styles.celebStorageVal}>{fmt(deletedStats.bytes).split(' ')[0]} <Text style={styles.celebStorageUnit}>{fmt(deletedStats.bytes).split(' ')[1]}</Text></Text>
                                <Text style={styles.celebStorageLbl}>Storage Recovered</Text>
                            </View>
                        ) : (
                            <View style={styles.celebStorage}>
                                <Text style={styles.celebStorageLbl}>No significant storage recovered</Text>
                            </View>
                        )}

                        <Pressable style={({ pressed }) => [styles.celebPrimaryBtn, pressed && { transform: [{ scale: 0.96 }] }]} onPress={closeCelebration}>
                            <LinearGradient colors={['#ef4444', '#dc2626']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.celebPrimaryGrad}>
                                <Text style={styles.celebPrimaryTxt}>Done</Text>
                            </LinearGradient>
                        </Pressable>
                    </RNAnimated.View>
                </Pressable>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },

    header: {
        paddingTop: 64, // Fallback
        paddingHorizontal: 20, paddingBottom: 8,
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    },
    title: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 32, letterSpacing: -0.5 },
    subtitle: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 13, marginTop: 4 },
    headerIconBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    deleteAllBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#ffffff',
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
        shadowColor: 'rgba(239,68,68,0.2)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2,
    },
    deleteAllTxt: { fontFamily: 'DMSans_700Bold', color: '#ef4444', fontSize: 13 },

    totalStatsCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: '#ffffff', marginHorizontal: 20, marginTop: 16, marginBottom: 8,
        padding: 16, borderRadius: 20,
        shadowColor: 'rgba(99,102,241,0.1)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
        borderWidth: 1, borderColor: 'rgba(99,102,241,0.05)',
    },
    totalStatsLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    totalStatsIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(99,102,241,0.08)', alignItems: 'center', justifyContent: 'center' },
    totalStatsLbl: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
    totalStatsVal: { fontFamily: 'DMSans_700Bold', color: '#6366f1', fontSize: 22, marginTop: -2 },
    totalStatsRight: { alignItems: 'flex-end' },
    totalStatsHint: { fontFamily: 'DMSans_700Bold', color: '#cbd5e1', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },

    storagePill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        marginHorizontal: 20, marginTop: 12,
        backgroundColor: '#ffffff',
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16,
        shadowColor: 'rgba(255,107,107,0.1)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2,
    },
    storagePillTxt: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 13 },

    hint: {
        fontFamily: 'DMSans_500Medium',
        color: '#9ca3af', fontSize: 12,
        textAlign: 'center', marginTop: 10, marginBottom: 4,
    },

    grid: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 },
    row: { gap: 3, marginBottom: 3 },
    gridItemWrap: { width: ITEM, height: ITEM, marginBottom: 3 },
    gridItem: {
        width: '100%', height: '100%',
        borderRadius: 12, overflow: 'hidden',
        backgroundColor: '#f3f4f6',
    },
    thumb: { width: '100%', height: '100%' },
    thumbGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: ITEM * 0.45 },
    daysBadge: {
        position: 'absolute', bottom: 5, right: 5,
        backgroundColor: 'rgba(0,0,0,0.45)',
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    },
    daysBadgeRed: { backgroundColor: '#ef4444' },
    daysTxt: { fontFamily: 'DMSans_700Bold', color: '#ffffff', fontSize: 10 },

    emptyWrap: { alignItems: 'center', paddingHorizontal: 40 },
    emptyIcon: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: '#ffffff',
        shadowColor: 'rgba(255,107,107,0.15)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    emptyTitle: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 24, marginBottom: 8 },
    emptySub: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 22 },

    footer: {
        position: 'absolute', bottom: 24, left: 16, right: 16,
        flexDirection: 'row', gap: 10,
    },
    recoverBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: '#ffffff',
        paddingVertical: 14, borderRadius: 16,
        shadowColor: 'rgba(255,107,107,0.15)', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 12, elevation: 4,
    },
    recoverTxt: { fontFamily: 'DMSans_700Bold', color: '#ff6b6b', fontSize: 15 },
    permDeleteBtn: { flex: 1, borderRadius: 16, overflow: 'hidden', shadowColor: '#ef4444', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
    permDeleteGrad: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 14,
        backgroundColor: '#ffffff',
        borderRadius: 16,
    },
    permDeleteTxt: { fontFamily: 'DMSans_700Bold', color: '#ef4444', fontSize: 15 },

    // Celebration Popup
    celebOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    celebCard: {
        width: '100%', backgroundColor: '#ffffff', borderRadius: 32, paddingHorizontal: 28, paddingTop: 36, paddingBottom: 24,
        alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(239,68,68,0.1)',
        shadowColor: 'rgba(239,68,68,0.2)', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 1, shadowRadius: 32, elevation: 12,
    },
    celebShimmer: {
        position: 'absolute', top: 0, left: 24, right: 24, height: 1,
        backgroundColor: 'rgba(239,68,68,0.2)',
    },
    celebIconWrap: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(239,68,68,0.1)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    orbitContainer: { position: 'absolute', width: 96, height: 96, alignItems: 'center', justifyContent: 'flex-start' },
    orbitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', shadowColor: '#ef4444', shadowOpacity: 0.6, shadowRadius: 6 },
    celebTitle: { fontFamily: 'DMSans_700Bold', color: '#1f2937', fontSize: 22, marginBottom: 20, textAlign: 'center', lineHeight: 28 },

    celebStorage: { alignItems: 'center', marginBottom: 32 },
    celebStorageVal: { fontFamily: 'DMSans_700Bold', color: '#ef4444', fontSize: 44, letterSpacing: -1.5, lineHeight: 54 },
    celebStorageUnit: { fontSize: 22, fontFamily: 'DMSans_700Bold' },
    celebStorageLbl: { fontFamily: 'DMSans_700Bold', color: '#9ca3af', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 0 },

    celebPrimaryBtn: { width: '100%', borderRadius: 100, overflow: 'hidden', marginBottom: 12, shadowColor: '#ef4444', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
    celebPrimaryGrad: { paddingVertical: 18, alignItems: 'center', position: 'relative' },
    celebPrimaryTxt: { fontFamily: 'DMSans_700Bold', color: '#fff', fontSize: 17, letterSpacing: 0.5 },
});
