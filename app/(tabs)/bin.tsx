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
import Constants from 'expo-constants';
import { AUTH_TOKEN_KEY } from '../(auth)/login';
import { auth } from '../../lib/firebase';
import { deleteUser } from 'firebase/auth';
import { ONBOARDING_COMPLETED_KEY } from '../onboarding';
import { PERMISSIONS_GRANTED_KEY } from '../permissions';
import { AppBannerAd, BannerAdSize, AdUnits } from '../../lib/ads';
import { useIAP } from '../../contexts/IAPContext';

const { width: W } = Dimensions.get('window');
const COL = 3;
const SPACING = 12;
const ITEM = (W - 40 - (COL - 1) * SPACING) / COL;
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
    const { isPro } = useIAP();
    const [isDeleting, setIsDeleting] = useState(false);
    const [previewPhoto, setPreviewPhoto] = useState<BinPhoto | null>(null);
    const [previewVideoUri, setPreviewVideoUri] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggleSelection = useCallback((id: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const fullPlayer = useVideoPlayer(previewPhoto && previewPhoto.mediaType === 'video' ? (previewVideoUri || previewPhoto.url) : null, (p) => {
        p.loop = true;
        p.play();
    });

    useEffect(() => {
        let active = true;
        if (previewPhoto && previewPhoto.mediaType === 'video') {
            const photoId = previewPhoto.id;
            MediaLibrary.getAssetInfoAsync(photoId).then(info => {
                if (active) setPreviewVideoUri(info.localUri || info.uri);
            }).catch(() => {});
        } else {
            setPreviewVideoUri(null);
        }
        return () => { active = false; };
    }, [previewPhoto]);

    // Initial Bin Tutorial 
    const BIN_TUTORIAL_KEY = '@bin_tutorial_v1';
    const [showBinTutorial, setShowBinTutorial] = useState(false);

    React.useEffect(() => {
        // Bin Tutorial Disabled as per request
        if (false && binPhotos.length > 0) {
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
        const anim = RNAnimated.loop(
            RNAnimated.timing(orbitSpin, {
                toValue: 1, duration: 4000, easing: Easing.linear as any, useNativeDriver: true
            })
        );
        anim.start();
        return () => anim.stop();
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

    const handleMainDelete = useCallback(() => {
        const isSelectionMode = selectedIds.size > 0;
        const count = isSelectionMode ? selectedIds.size : binPhotos.length;
        
        Alert.alert(
            isSelectionMode ? 'Delete Selected?' : 'Delete All Permanently?',
            `Remove ${count} items from your device. This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive',
                    onPress: async () => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        setIsDeleting(true);
                        
                        let success = false;
                        let bytesValue = 0;
                        if (isSelectionMode) {
                            bytesValue = Array.from(selectedIds).reduce((acc, id) => {
                                const p = binPhotos.find(b => b.id === id);
                                return acc + (p?.fileSize || 0);
                            }, 0);
                            success = await commitDeletions(Array.from(selectedIds));
                            if (success) setSelectedIds(new Set());
                        } else {
                            bytesValue = binStorageBytes;
                            success = await commitDeletions();
                        }
                        setIsDeleting(false);
                        if (success) {
                            showCelebration(count, bytesValue);
                        }
                    },
                },
            ]
        );
    }, [binPhotos, selectedIds, commitDeletions, binStorageBytes]);

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
        const isSelected = selectedIds.has(item.id);
        
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
                    onPress={() => toggleSelection(item.id)}
                >
                    <Image 
                        source={item.url || 'https://via.placeholder.com/150'} 
                        style={[styles.thumb, isSelected && { opacity: 0.8 }]} 
                        contentFit="cover" 
                    />
                    {/* Select Circle */}
                    <View style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: isSelected ? 'transparent' : '#fff', backgroundColor: isSelected ? '#FF6B6B' : 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                    
                    {/* Days badge */}
                    <View style={[styles.daysBadge, { backgroundColor: urgent ? '#FF3B30' : 'rgba(0,0,0,0.5)' }]}>
                        <Text style={styles.daysTxt}>{days}d</Text>
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

            {/* Header: Home Left, Title Center, Empty Right */}
            <View style={[styles.header, { paddingTop: Math.max(insets.top, 16), height: 72 + insets.top, paddingHorizontal: 20 }]}>
                <View style={{ flex: 1, alignItems: 'flex-start' }}>
                    <ScalePress
                        style={styles.headerIconBtn}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            router.back();
                        }}
                    >
                        <Ionicons name="home" size={20} color="#1C1C1E" />
                    </ScalePress>
                </View>

                <View style={{ flex: 4, alignItems: 'center' }}>
                    <ScalePress onPress={() => setShowBinTutorial(true)}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.title}>Review Bin</Text>
                            <Ionicons name="search" size={18} color="#A1A1AA" />
                        </View>
                    </ScalePress>
                    <Text style={styles.subtitle}>{binPhotos.length.toLocaleString()} items · {fmt(binStorageBytes)}</Text>
                </View>

                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    {/* Placeholder for balance */}
                    <View style={{ width: 44 }} />
                </View>
            </View>

            {/* Banner: Brand Awareness */}
            <View style={{ marginHorizontal: 20, marginBottom: 20 }}>
                <View style={{ backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#EDEDED' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
                        <Ionicons name="shield-checkmark" size={22} color="#FF6B6B" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: 'System', fontSize: 15, fontWeight: '700', color: '#1C1C1E', marginBottom: 2 }}>Safe in the Bin</Text>
                        <Text style={{ fontFamily: 'System', fontSize: 13, color: '#6B7280' }}>Items here will automatically clear completely after 7 days.</Text>
                    </View>
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
                    { paddingBottom: Math.max(insets.bottom, 24) + 350 }, 
                    binPhotos.length === 0 && { flex: 1, justifyContent: 'center', paddingBottom: 0 },
                ]}
                ListEmptyComponent={<EmptyState />}
                showsVerticalScrollIndicator={false}
                columnWrapperStyle={binPhotos.length > 0 ? styles.row : undefined}
            />

            {/* Footer Buttons - Adjusted for Ads */}
            {binPhotos.length > 0 && (
                <View style={[styles.footer, { bottom: Math.max(insets.bottom, 20) + (isPro ? 12 : 72) }]}>
                    <ScalePress
                        style={styles.deleteBtn}
                        onPress={handleMainDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="trash-outline" size={18} color="#fff" />
                                <Text style={styles.deleteTxt}>
                                    {selectedIds.size > 0 
                                        ? `Delete Selected · ${fmt(Array.from(selectedIds).reduce((acc, id) => acc + (binPhotos.find(b => b.id === id)?.fileSize || 0), 0))}` 
                                        : `Delete All · ${fmt(binStorageBytes)}`}
                                </Text>
                            </>
                        )}
                    </ScalePress>
                    
                    <ScalePress
                        style={styles.recoverBtn}
                        onPress={async () => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            if (selectedIds.size > 0) {
                                for (const id of selectedIds) await restoreFromBin(id);
                                setSelectedIds(new Set());
                            } else {
                                // Restore ALL functionality
                                Alert.alert('Restore All?', `Bring back all ${binPhotos.length} items to your gallery?`, [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Restore All', onPress: async () => {
                                        for (const p of [...binPhotos]) await restoreFromBin(p.id);
                                    }}
                                ]);
                            }
                        }}
                    >
                        <Text style={styles.recoverTxt}>
                            {selectedIds.size > 0 ? `Restore Selected (${selectedIds.size})` : 'Restore All Items'}
                        </Text>
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
                            Welcome to the Review Bin! Your items are safe here.
                        </Text>
                        <Text style={styles.tutBinDesc2}>
                            Select items to restore, or let them automatically clear in 7 days.
                        </Text>
                        <Text style={[styles.tutBinDesc2, { marginTop: 12 }]}>
                            Hit <Text style={{fontWeight: '800', color: '#ef4444'}}>Delete All</Text> at the bottom to permanently free up space right now.
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

            {/* Bottom Banner Ad - Only for non-pro */}
            {!isPro && (
                <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, 20), left: 0, right: 0, alignItems: 'center' }}>
                    <AppBannerAd
                        unitId={AdUnits.BANNER}
                        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFFFFF' },
    header: {
        paddingHorizontal: 20, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 10,
    },
    title: { 
        fontSize: 24, 
        fontFamily: 'System', 
        fontWeight: '800',
        color: '#1C1C1E', 
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 13,
        fontFamily: 'System',
        color: '#A1A1AA',
        fontWeight: '500'
    },
    headerIconBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
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

    mainBanner: {
        padding: 20,
        borderRadius: 20,
        marginBottom: 16,
        shadowColor: '#ff6b6b',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 8,
    },
    mainBannerSub: { fontFamily: 'System', fontSize: 11, color: '#fff', opacity: 0.9, marginBottom: 4, letterSpacing: 1 },
    mainBannerTitle: { fontFamily: 'System', fontSize: 32, color: '#fff', marginBottom: 2, letterSpacing: -1 },
    mainBannerDesc: { fontFamily: 'System', fontSize: 13, color: '#fff', opacity: 0.95 },
    
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#ecfdf5',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#d1fae5',
        marginBottom: 8,
    },
    infoBannerIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    infoBannerTitle: { fontFamily: 'System', fontSize: 14, color: '#059669', marginBottom: 2 },
    infoBannerDesc: { fontFamily: 'System', fontSize: 12, color: '#4b5563', lineHeight: 18 },

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
    settingsTitle: { fontFamily: 'System', fontSize: 24, color: '#1f2937' },
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
        flex: 1, fontFamily: 'System',
        fontSize: 16, color: '#4b5563',
    },
    settingsDivider: {
        height: 1, backgroundColor: '#f3f4f6',
        marginVertical: 12, marginHorizontal: 4,
    },
    versionTxt: {
        textAlign: 'center', marginTop: 20,
        fontFamily: 'System', fontSize: 12, color: '#9ca3af',
    },

    grid: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 240 },
    row: { gap: 12, marginBottom: 12 },
    gridItemWrap: { width: ITEM, height: ITEM },
    gridItem: {
        width: '100%', height: '100%',
        borderRadius: 12, overflow: 'hidden',
    },
    thumb: { width: '100%', height: '100%' },
    daysBadge: {
        position: 'absolute', top: 8, right: 8,
        paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
    },
    daysTxt: { color: '#ffffff', fontSize: 11, fontFamily: 'System' },

    emptyWrap: { alignItems: 'center', paddingHorizontal: 40, marginTop: 40 },
    emptyIcon: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: '#F8F8FA',
        borderWidth: 1, borderColor: '#EDEDED',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    },
    emptyTitle: { fontSize: 22, fontWeight: '700', color: '#1C1C1E', marginBottom: 10 },
    emptySub: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
    
    footer: {
        position: 'absolute', 
        left: 20, 
        right: 20,
        flexDirection: 'column', 
        gap: 12,
        backgroundColor: 'transparent',
    },
    recoverBtn: {
        width: '100%', 
        height: 52,
        backgroundColor: '#FFFFFF',
        borderRadius: 26,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1, borderColor: '#EDEDED',
        shadowColor: 'rgba(0,0,0,0.02)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 1,
    },
    recoverTxt: { fontFamily: 'System', color: '#6B7280', fontSize: 16, fontWeight: '600' },
    deleteBtn: { 
        width: '100%', 
        height: 52,
        backgroundColor: '#FF3B30',
        borderRadius: 26,
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8,
    },
    deleteTxt: { fontFamily: 'System', color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

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
    celebTitle: { fontFamily: 'System', color: '#1f2937', fontSize: 22, marginBottom: 20, textAlign: 'center', lineHeight: 28 },

    celebStorage: { alignItems: 'center', marginBottom: 32 },
    celebStorageVal: { fontFamily: 'System', color: '#ff6b6b', fontSize: 44, letterSpacing: -1.5, lineHeight: 54 },
    celebStorageUnit: { fontSize: 22, fontFamily: 'System' },
    celebStorageLbl: { fontFamily: 'System', color: '#9ca3af', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 0 },

    celebPrimaryBtn: { width: '100%', borderRadius: 100, overflow: 'hidden', marginBottom: 12, shadowColor: '#ff6b6b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
    celebPrimaryGrad: { paddingVertical: 18, alignItems: 'center', position: 'relative' },
    celebPrimaryTxt: { fontFamily: 'System', color: '#fff', fontSize: 17, letterSpacing: 0.5 },

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
