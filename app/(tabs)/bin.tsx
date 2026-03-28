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
import Animated, { Layout, FadeIn, FadeOut, useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
    firebaseAuthREST, 
    AUTH_TOKEN_KEY, 
    AUTH_ID_TOKEN, 
    ONBOARDING_COMPLETED_KEY, 
    PERMISSIONS_GRANTED_KEY 
} from '../../lib/firebase';
import { AppBannerAd, BannerAdSize, AdUnits } from '../../lib/ads';

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
    const { 
        binPhotos, commitDeletions, restoreFromBin, binStorageBytes, 
        totalClearedBytes, totalDeletedPhotos, sessionStats, loadCategoryStats,
        deepReset, isGuest, setUserToken, setShowIntro, endSession
    } = usePhotos();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSettingsVisible, setIsSettingsVisible] = useState(false);

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

    const handleSignOut = async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShowIntro(true);
        endSession();
        await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
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
                            const idToken = await AsyncStorage.getItem(AUTH_ID_TOKEN);
                            if (idToken) {
                                await firebaseAuthREST('delete', { idToken });
                            }
                            // Clean Slate: Reset all V5 keys
                            await AsyncStorage.multiRemove([
                                AUTH_TOKEN_KEY, 
                                AUTH_ID_TOKEN,
                                ONBOARDING_COMPLETED_KEY, 
                                PERMISSIONS_GRANTED_KEY,
                                '@total_cleared_bytes_v2',
                                '@total_deleted_photos_v2',
                                '@bin_photos_v2'
                            ]);
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
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 20), flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
                {/* Row 1: Title and Badges */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' }}>
                    <Text style={styles.title}>Review Bin</Text>
                    <View style={styles.statBadge}>
                        <Ionicons name="trash" size={12} color="#f43f5e" />
                        <Text style={styles.statBadgeTxt}>
                            <Text style={{ fontWeight: '800', color: '#f43f5e' }}>{totalDeletedPhotos || 0}</Text> deleted
                        </Text>
                    </View>
                    <View style={[styles.statBadge, { borderColor: '#f59e0b25' }]}>
                        <Ionicons name="flash" size={12} color="#f59e0b" />
                        <Text style={styles.statBadgeTxt}>
                            <Text style={{ fontWeight: '800', color: '#1f2937' }}>{(totalClearedBytes / 1024 / 1024).toFixed(1)}</Text> MB cleared
                        </Text>
                    </View>
                </View>

                {/* Row 2: Subtitle */}
                <Text style={styles.subtitle}>
                    {binPhotos.length} items · {fmt(binStorageBytes)} to free
                </Text>

                {/* Row 3: Utility Icons */}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                    <ScalePress 
                        style={styles.headerIconBtn} 
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            loadCategoryStats();
                        }}
                    >
                        <Ionicons name="refresh-outline" size={20} color="#9ca3af" />
                    </ScalePress>
                    <ScalePress 
                        style={[styles.headerIconBtn, { borderColor: '#f3f4f6' }]}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            setIsSettingsVisible(true);
                        }}
                    >
                        <Ionicons name="settings-outline" size={20} color="#6366f1" />
                    </ScalePress>
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

            {/* Footer Buttons */}
            {binPhotos.length > 0 && (
                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                    <ScalePress
                        style={styles.recoverBtn}
                        onPress={async () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            for (const p of binPhotos) await restoreFromBin(p.id);
                        }}
                    >
                        <Ionicons name="arrow-undo" size={18} color="#f43f5e" />
                        <Text style={styles.recoverTxt}>Recover All</Text>
                    </ScalePress>

                    <ScalePress
                        style={styles.deleteBtn}
                        onPress={handleDeleteAll}
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="trash" size={18} color="#fff" />
                                <Text style={styles.deleteTxt}>Delete All</Text>
                            </>
                        )}
                    </ScalePress>
                </View>
            )}

            {/* Settings Modal */}
            <Modal
                visible={isSettingsVisible}
                animationType="fade"
                transparent={true}
                onRequestClose={() => setIsSettingsVisible(false)}
            >
                <Pressable 
                    style={styles.settingsOverlay} 
                    onPress={() => setIsSettingsVisible(false)}
                >
                    <Animated.View 
                        entering={FadeIn.duration(200)} 
                        exiting={FadeOut.duration(200)}
                        style={styles.settingsContent}
                    >
                        <View style={styles.settingsHeader}>
                            <Text style={styles.settingsTitle}>Settings</Text>
                            <Pressable onPress={() => setIsSettingsVisible(false)} style={styles.settingsClose}>
                                <Ionicons name="close" size={20} color="#9ca3af" />
                            </Pressable>
                        </View>

                        <View style={styles.settingsList}>
                            <ScalePress 
                                style={styles.settingsOption}
                                onPress={() => {
                                    setIsSettingsVisible(false);
                                    if (isGuest) {
                                        setUserToken(null);
                                        AsyncStorage.removeItem(AUTH_TOKEN_KEY);
                                        router.replace('/login');
                                    } else {
                                        handleSignOut();
                                    }
                                }}
                            >
                                <View style={[styles.settingsIconWrap, { backgroundColor: isGuest ? 'rgba(52,211,153,0.08)' : 'rgba(99,102,241,0.08)' }]}>
                                    <Ionicons name={isGuest ? "log-in-outline" : "log-out-outline"} size={22} color={isGuest ? "#10b981" : "#6366f1"} />
                                </View>
                                <Text style={styles.settingsOptionTxt}>{isGuest ? "Log In (Upgrade Account)" : "Sign Out"}</Text>
                                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                            </ScalePress>

                             <ScalePress 
                                style={styles.settingsOption}
                                onPress={() => {
                                    setIsSettingsVisible(false);
                                    Alert.alert(
                                        'Reset App?',
                                        'This will clear all your swipe history and start fresh.',
                                        [
                                            { text: 'Cancel', style: 'cancel' },
                                            { 
                                                text: 'Reset Everything', 
                                                style: 'destructive',
                                                onPress: async () => {
                                                    await deepReset();
                                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                                }
                                            }
                                        ]
                                    );
                                }}
                            >
                                <View style={[styles.settingsIconWrap, { backgroundColor: 'rgba(52,211,153,0.08)' }]}>
                                    <Ionicons name="refresh-circle-outline" size={22} color="#10b981" />
                                </View>
                                <Text style={styles.settingsOptionTxt}>Deep Reset App</Text>
                                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                            </ScalePress>

                            <View style={styles.settingsDivider} />

                            <ScalePress 
                                style={styles.settingsOption}
                                onPress={() => {
                                    setIsSettingsVisible(false);
                                    handleDeleteAccount();
                                }}
                            >
                                <View style={[styles.settingsIconWrap, { backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                                    <Ionicons name="trash-outline" size={22} color="#ef4444" />
                                </View>
                                <Text style={[styles.settingsOptionTxt, { color: '#ef4444' }]}>Delete Account</Text>
                                <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
                            </ScalePress>
                        </View>
                        
                        <Text style={styles.versionTxt}>Version 1.0.0 (Production Stable V5)</Text>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Banner Ad */}
            <View style={{ position: 'absolute', bottom: insets.bottom + 8, left: 0, right: 0, alignItems: 'center' }}>
                <AppBannerAd
                    unitId={AdUnits.BANNER}
                    size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },
    header: { paddingHorizontal: 20, paddingBottom: 8 },
    title: { fontSize: 24, fontWeight: '900', color: '#1f2937' },
    subtitle: { fontSize: 13, color: '#9ca3af', fontWeight: '600' },
    headerIconBtn: {
        width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 4, elevation: 2,
        borderWidth: 1, borderColor: '#f3f4f6',
    },
    statBadge: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, gap: 5,
        borderWidth: 1, borderColor: 'rgba(239,68,68,0.1)',
    },
    statBadgeTxt: { fontSize: 12, fontWeight: '600', color: '#1f2937' },
    grid: { paddingHorizontal: 16, paddingTop: 15 },
    row: { gap: 3, marginBottom: 3 },
    gridItemWrap: { width: ITEM, height: ITEM },
    gridItem: { width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden' },
    thumb: { width: '100%', height: '100%' },
    thumbGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },
    daysBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
    daysBadgeRed: { backgroundColor: '#ef4444' },
    daysTxt: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
    emptyIcon: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    emptyTitle: { fontSize: 22, fontWeight: '800', color: '#333', marginBottom: 10 },
    emptySub: { fontSize: 15, color: '#999', textAlign: 'center', lineHeight: 22 },
    footer: { position: 'absolute', bottom: 106, left: 20, right: 20, flexDirection: 'row', gap: 12 },
    recoverBtn: { flex: 1, height: 52, backgroundColor: '#fff', borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: '#fef2f2' },
    recoverTxt: { color: '#f43f5e', fontSize: 15, fontWeight: '700' },
    deleteBtn: { flex: 1, height: 52, backgroundColor: '#ff4757', borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    deleteTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    settingsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    settingsContent: { width: '100%', backgroundColor: '#fff', borderRadius: 24, padding: 24 },
    settingsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    settingsTitle: { fontSize: 24, fontWeight: '800', color: '#1f2937' },
    settingsClose: { padding: 4 },
    settingsList: { gap: 4 },
    settingsOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    settingsIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    settingsOptionTxt: { flex: 1, fontSize: 16, fontWeight: '700', color: '#4b5563' },
    settingsDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 12 },
    versionTxt: { textAlign: 'center', marginTop: 20, fontSize: 12, color: '#9ca3af' },
});
