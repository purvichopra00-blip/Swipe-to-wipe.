import React, { useCallback, useState, useEffect } from 'react';
import {
    StyleSheet, View, Text, Pressable, Alert,
    ActivityIndicator, FlatList, Dimensions, StatusBar,
    Modal, Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { usePhotos } from '../../contexts/PhotoContext';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { BinPhoto } from '../../contexts/PhotoContext';
import ConfettiCannon from 'react-native-confetti-cannon';
import { Easing } from 'react-native-reanimated';
import Animated, { Layout, FadeIn, FadeOut, FadeInDown, useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_TOKEN_KEY } from '../(auth)/login';
import { auth } from '../../lib/firebase';
import { deleteUser } from 'firebase/auth';
import { ONBOARDING_COMPLETED_KEY } from '../onboarding';
import { PERMISSIONS_GRANTED_KEY } from '../permissions';
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
    const [previewPhoto, setPreviewPhoto] = useState<BinPhoto | null>(null);
    const [previewVideoUri, setPreviewVideoUri] = useState<string | null>(null);

    const fullPlayer = useVideoPlayer(previewPhoto && previewPhoto.mediaType === 'video' ? (previewVideoUri || previewPhoto.url) : null, (p) => {
        p.loop = true;
        p.play();
    });

    useEffect(() => {
        if (previewPhoto && previewPhoto.mediaType === 'video') {
            MediaLibrary.getAssetInfoAsync(previewPhoto.id).then(info => {
                setPreviewVideoUri(info.localUri || info.uri);
            });
        } else {
            setPreviewVideoUri(null);
        }
    }, [previewPhoto]);

    // Initial Bin Tutorial 
    const BIN_TUTORIAL_KEY = '@bin_tutorial_v1';
    const [showBinTutorial, setShowBinTutorial] = useState(false);

    React.useEffect(() => {
        if (binPhotos.length > 0) {
            AsyncStorage.getItem(BIN_TUTORIAL_KEY).then(res => {
                if (!res) {
                    setShowBinTutorial(true);
                }
            });
        }
    }, [binPhotos.length]);

    const completeBinTutorial = () => {
        setShowBinTutorial(false);
        AsyncStorage.setItem(BIN_TUTORIAL_KEY, 'done');
    };

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

    const daysLeft = (d: number) => {
        if (!d) return 0;
        return Math.max(0, Math.ceil((SEVEN_DAYS - (Date.now() - d)) / 86400000));
    };

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
                            const user = auth.currentUser;
                            if (user) {
                                await deleteUser(user);
                            }
                             // Deep Wipe: Clear all local data and preferences
                             await deepReset();
                             
                             Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                             router.replace('/login');
                        } catch (err: any) {
                            console.error('Delete account error', err);
                            if (err.code === 'auth/requires-recent-login') {
                                Alert.alert('Security Check', 'For security reasons, please log out and log back in before deleting your account.');
                            } else {
                                Alert.alert('Error', 'Failed to delete account. Please try again.');
                            }
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
                    onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPreviewPhoto(item);
                    }}
                    onPress={() => handleRestore(item)}
                >
                    <Image 
                        source={item.url || 'https://via.placeholder.com/150'} 
                        style={styles.thumb} 
                        contentFit="cover" 
                    />
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
                    {/* Failsafe Hidden Tutorial Button on the Title string */}
                    <ScalePress onPress={() => setShowBinTutorial(true)}>
                        <Text style={styles.title}>Review Bin</Text>
                    </ScalePress>
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

            {/* Grid */}
            <FlatList
                data={binPhotos}
                renderItem={renderItem}
                keyExtractor={item => item.id}
                numColumns={3}
                contentContainerStyle={[
                    styles.grid,
                    { paddingBottom: Math.max(insets.bottom, 20) + 320 }, 
                    binPhotos.length === 0 && { flex: 1, justifyContent: 'center', paddingBottom: 0 },
                ]}
                ListEmptyComponent={<EmptyState />}
                showsVerticalScrollIndicator={false}
                columnWrapperStyle={binPhotos.length > 0 ? styles.row : undefined}
            />

            {/* Footer Buttons */}
            {binPhotos.length > 0 && (
                <View style={[styles.footer, { bottom: Math.max(insets.bottom, 20) + 144 }]}>
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
                                        // "Log In" for Guest = Sign Out + Go to Login
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
                                    // Use existing handleDeleteAll to trigger the reset
                                    // But actually we want a FULL app reset here
                                    Alert.alert(
                                        'Reset App?',
                                        'This will clear all your swipe history and start fresh. Your photos on device will NOT be deleted.',
                                        [
                                            { text: 'Cancel', style: 'cancel' },
                                            { 
                                                text: 'Reset Everything', 
                                                style: 'destructive',
                                                onPress: async () => {
                                                    await deepReset();
                                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                                    setIsSettingsVisible(false);
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
                        
                        <Text style={styles.versionTxt}>Version 1.0.0 (Production Ready)</Text>
                    </Animated.View>
                </Pressable>
            </Modal>

            {/* Full Preview Modal */}
            <Modal
                visible={!!previewPhoto}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setPreviewPhoto(null)}
            >
                {previewPhoto && (
                    <View style={styles.previewContainer}>
                        <StatusBar hidden />
                        <View style={styles.previewHeader}>
                            <ScalePress onPress={() => setPreviewPhoto(null)} style={styles.previewCloseBtn}>
                                <Ionicons name="close" size={28} color="#fff" />
                            </ScalePress>
                        </View>
                        
                        {previewPhoto.mediaType === 'video' ? (
                            <VideoView
                                player={fullPlayer}
                                style={styles.previewImage}
                                contentFit="contain"
                            />
                        ) : (
                            <Image 
                                source={previewPhoto.url} 
                                style={styles.previewImage} 
                                contentFit="contain" 
                            />
                        )}

                        {/* Preview Footer Toolpad */}
                        <View style={[styles.previewFooter, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                            <ScalePress
                                style={styles.previewActionBtn}
                                onPress={() => {
                                    setPreviewPhoto(null);
                                    setTimeout(() => handleRestore(previewPhoto), 150);
                                }}
                            >
                                <View style={[styles.previewActionIconCover, { backgroundColor: 'rgba(244,63,94,0.15)' }]}>
                                    <Ionicons name="arrow-undo" size={24} color="#f43f5e" />
                                </View>
                                <Text style={[styles.previewActionText, { color: '#f43f5e' }]}>Restore</Text>
                            </ScalePress>

                            <ScalePress
                                style={styles.previewActionBtn}
                                onPress={() => {
                                    setPreviewPhoto(null);
                                    setTimeout(() => handleDeleteOne(previewPhoto), 150);
                                }}
                            >
                                <View style={[styles.previewActionIconCover, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                                    <Ionicons name="trash" size={24} color="#ef4444" />
                                </View>
                                <Text style={[styles.previewActionText, { color: '#ef4444' }]}>Delete</Text>
                            </ScalePress>
                        </View>
                    </View>
                )}
            </Modal>

            {/* Bin Tutorial Overlay */}
            {showBinTutorial && (
                <View style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999, justifyContent: 'center' }]} pointerEvents="box-none">
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.8)' }]} />
                    
                    <Animated.View entering={FadeInDown.duration(600).delay(300).springify()} style={styles.tutBinOverlay}>
                        <View style={[styles.tutIconWrap, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
                            <Ionicons name="information-circle" size={44} color="#3b82f6" />
                        </View>
                        <Text style={styles.tutBinTitle}>Last Chance!</Text>
                        <Text style={styles.tutBinDesc}>
                            Tap any photo here to <Text style={{fontWeight: '800', color: '#fff'}}>Restore</Text> it back to your gallery.
                        </Text>
                        <Text style={styles.tutBinDesc2}>
                            <Text style={{fontWeight: '800', color: '#fff'}}>Long press</Text> a photo to preview it fullscreen and review it before deciding.
                        </Text>
                        <Text style={[styles.tutBinDesc2, { marginTop: 12 }]}>
                            Or, hit <Text style={{fontWeight: '800', color: '#ef4444'}}>Delete All</Text> at the bottom to permanently free up space.
                        </Text>
                        
                        <ScalePress style={styles.tutBinBtn} onPress={completeBinTutorial}>
                            <Text style={styles.tutBinBtnText}>Got it!</Text>
                        </ScalePress>
                    </Animated.View>

                    <Animated.View entering={FadeInDown.duration(1000).delay(800).springify()} style={styles.tutArrowContainer}>
                        <RNAnimated.Text style={styles.tutArrow}>↓</RNAnimated.Text>
                    </Animated.View>
                </View>
            )}

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

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff0f5' },

    header: {
        paddingTop: 64, // Fallback
        paddingHorizontal: 20, paddingBottom: 8,
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    },
    title: { 
        fontSize: 19, 
        fontWeight: '900', 
        color: '#1f2937', 
        letterSpacing: -0.3 
    },

    subtitle: {
        fontSize: 13,
        color: '#9ca3af',
        fontWeight: '600',
        marginTop: 0,
    },
    headerIconBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: 'rgba(0,0,0,0.05)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 4,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    statBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 5,
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.1)',
        shadowColor: 'rgba(0,0,0,0.02)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 2,
    },
    statBadgeTxt: {
        fontSize: 12,
        fontWeight: '600',
    },
    totalStatsLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    totalStatsIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(99,102,241,0.08)', alignItems: 'center', justifyContent: 'center' },
    totalStatsLbl: { fontFamily: 'DMSans_500Medium', color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
    totalStatsVal: { fontFamily: 'DMSans_700Bold', color: '#6366f1', fontSize: 22, marginTop: -2 },
    totalStatsRight: { alignItems: 'flex-end' },
    totalStatsHint: { fontFamily: 'DMSans_700Bold', color: '#cbd5e1', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },

    storagePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 20,
        marginTop: 12,
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 20,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 3,
    },
    storagePillTxt: { color: '#666', fontSize: 15, fontWeight: '600' },

    settingsOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center', alignItems: 'center',
        padding: 24,
    },
    settingsContent: {
        width: '100%', backgroundColor: '#fff',
        borderRadius: 24, padding: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.15, shadowRadius: 30, elevation: 20,
    },
    settingsHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20,
    },
    settingsTitle: { fontFamily: 'Syne_700Bold', fontSize: 24, color: '#1f2937' },
    settingsClose: { padding: 4 },
    settingsList: { gap: 4 },
    settingsOption: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 14, paddingHorizontal: 4,
    },
    settingsIconWrap: {
        width: 44, height: 44, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
        marginRight: 14,
    },
    settingsOptionTxt: {
        flex: 1, fontFamily: 'DMSans_700Bold',
        fontSize: 16, color: '#4b5563',
    },
    settingsDivider: {
        height: 1, backgroundColor: '#f3f4f6',
        marginVertical: 12, marginHorizontal: 4,
    },
    versionTxt: {
        textAlign: 'center', marginTop: 20,
        fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#9ca3af',
    },
    hint: {
        color: '#9ca3af', fontSize: 13,
        textAlign: 'center', marginTop: 15, marginBottom: 4,
        fontWeight: '500',
    },

    grid: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 120 },
    row: { gap: 3, marginBottom: 3 },
    gridItemWrap: { width: ITEM, height: ITEM, marginBottom: 3 },
    gridItem: {
        width: '100%', height: '100%',
        borderRadius: 12, overflow: 'hidden',
    },
    thumb: { width: '100%', height: '100%' },
    thumbGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: ITEM * 0.45 },
    daysBadge: {
        position: 'absolute', bottom: 8, right: 8,
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
    },
    daysBadgeRed: { backgroundColor: '#ef4444' },
    daysTxt: { color: '#ffffff', fontSize: 10, fontWeight: '800' },

    emptyWrap: { alignItems: 'center', paddingHorizontal: 40, marginTop: 40 },
    emptyIcon: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: '#ffffff',
        shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 1, shadowRadius: 16, elevation: 4,
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    emptyTitle: { fontSize: 22, fontWeight: '800', color: '#333', marginBottom: 10 },
    emptySub: { fontSize: 15, color: '#999', textAlign: 'center', lineHeight: 22 },
    footer: {
        position: 'absolute', 
        bottom: 154, 
        left: 20, 
        right: 20,
        flexDirection: 'row', 
        gap: 12,
        backgroundColor: 'transparent',
    },
    recoverBtn: {
        flex: 1, 
        height: 52,
        backgroundColor: '#fff',
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderWidth: 1.5,
        borderColor: '#fef2f2',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 3,
    },
    recoverTxt: { color: '#f43f5e', fontSize: 15, fontWeight: '700' },
    deleteBtn: { 
        flex: 1, 
        height: 52,
        backgroundColor: '#ff4757', // More vibrant red to look active
        borderRadius: 20,
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8,
        shadowColor: '#ef4444', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8 
    },
    deleteTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },

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

    // Bin Tutorial Styles
    tutBinOverlay: {
        marginHorizontal: 32,
        backgroundColor: '#1f2937',
        borderRadius: 32,
        padding: 32,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.4,
        shadowRadius: 30,
        elevation: 24,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)'
    },
    tutIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
    tutBinTitle: { fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 12, textAlign: 'center' },
    tutBinDesc: { fontSize: 16, color: '#d1d5db', textAlign: 'center', lineHeight: 24, marginBottom: 8 },
    tutBinDesc2: { fontSize: 15, color: '#9ca3af', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
    tutBinBtn: { width: '100%', backgroundColor: '#fff', paddingVertical: 18, borderRadius: 20, alignItems: 'center' },
    tutBinBtnText: { fontSize: 17, fontWeight: '800', color: '#1f2937' },
    tutArrowContainer: { position: 'absolute', bottom: 180, right: 100, alignItems: 'center' },
    tutArrow: { fontSize: 64, color: '#fff', fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width: 0, height: 4}, textShadowRadius: 8 },

    // Preview
    previewContainer: { flex: 1, backgroundColor: '#000' },
    previewHeader: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
    previewCloseBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    previewImage: { width: '100%', height: '100%' },
    previewFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 48, paddingBottom: 60, paddingTop: 30, backgroundColor: 'rgba(0,0,0,0.7)' },
    previewActionBtn: { alignItems: 'center', gap: 6 },
    previewActionIconCover: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    previewActionText: { fontWeight: '800', fontSize: 14 }
});
