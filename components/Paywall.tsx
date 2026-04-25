import React, { useState, useEffect } from 'react';
import {
    StyleSheet, Text, View, Pressable, Modal,
    Dimensions, ScrollView, ActivityIndicator, Platform, Alert
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    FadeInDown, SlideInDown, useSharedValue, useAnimatedStyle,
    withRepeat, withSequence, withTiming, Easing
} from 'react-native-reanimated';
import { useIAP } from '../contexts/IAPContext';
import { usePhotos } from '../contexts/PhotoContext';
import { useRouter } from 'expo-router';
import { createSafeRewarded, AdUnits, AdEventType, RewardedAdEventType } from '../lib/ads';

const { width: W, height: H } = Dimensions.get('window');

interface PaywallProps {
    visible: boolean;
    onClose: () => void;
    reason?: 'limit' | 'ad' | 'upgrade';
}

export default function Paywall({ visible, onClose, reason = 'limit' }: PaywallProps) {
    const { isPro, product, purchaseProduct, restorePurchases, isLoading, addRewardSwipes } = useIAP();
    const { userToken } = usePhotos();
    const router = useRouter();
    const [connError, setConnError] = useState(false);

    // ✅ AUTO-CLOSE WHEN PRO (Apple Success Flow)
    useEffect(() => {
        if (isPro && visible) {
            const timer = setTimeout(() => {
                onClose();
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isPro, visible]);

    // ✅ RESCUE TIMEOUT (If store hangs)
    useEffect(() => {
        if (visible && !product) {
            const timer = setTimeout(() => {
                if (!product) setConnError(true);
            }, 15000); // 15 seconds
            return () => clearTimeout(timer);
        } else if (product) {
            setConnError(false);
        }
    }, [visible, product]);

    const [rewardedAd, setRewardedAd] = useState<any>(null);
    const [isAdLoading, setIsAdLoading] = useState(false);

    useEffect(() => {
        if (!visible || reason !== 'limit') return;
        let isMounted = true;

        const ad = createSafeRewarded(AdUnits.REWARDED);
        if (!ad) return;

        let earnedReward = false;
        const unsubscribeLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
            if (isMounted) setRewardedAd(ad);
        });

        const unsubscribeEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
            earnedReward = true;
        });

        const unsubscribeClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
            if (isMounted) {
                setRewardedAd(null);
                if (earnedReward) {
                    addRewardSwipes();
                    Alert.alert("Reward Earned! 🎁", "You've been granted 25 extra swipes. Keep cleaning!");
                    onClose();
                }
            }
        });

        ad.load();

        return () => {
            isMounted = false;
            unsubscribeLoaded();
            unsubscribeEarned();
            unsubscribeClosed();
        };
    }, [visible, reason]);

    const handleWatchAd = () => {
        if (rewardedAd) {
            setIsAdLoading(true);
            try {
                rewardedAd.show();
            } catch (e) {
                Alert.alert("Ad Error", "Could not play the ad right now. Please try again.");
            } finally {
                setIsAdLoading(false);
            }
        } else {
            Alert.alert("Loading...", "The ad is still loading. Please try again in a moment.");
        }
    };

    const handlePurchase = async () => {
        if (userToken === 'guest') {
            Alert.alert(
                'Create an Account',
                'To secure your lifetime Pro access and sync your progress across devices, please log in or create an account first.',
                [
                    { text: 'Continue as Guest', onPress: () => proceedWithPurchase() },
                    { text: 'Log In / Register', onPress: () => { onClose(); router.replace('/login'); } }
                ]
            );
            return;
        }
        await proceedWithPurchase();
    };

    const proceedWithPurchase = async () => {
        if (!product) {
            // Force a manual retry of the IAP connection if it's missing
            try {
                const retrySuccess = await purchaseProduct(); // This will trigger the connection warming
                if (!retrySuccess) {
                    Alert.alert('Store Connection', 'We are attempting to reconnect to the App Store. Please try again in a few seconds.');
                }
            } catch (e) {
                Alert.alert('Store Loading', 'We are still connecting to the App Store. Please try again in a moment.');
            }
            return;
        }
        await purchaseProduct();
    };

    const handleRestore = async () => {
        const success = await restorePurchases();
        if (success) {
            onClose();
            if (userToken === 'guest') {
                setTimeout(() => {
                    Alert.alert(
                        'Access Restored!',
                        'Welcome back! Please log in to sync your Pro features and history.',
                        [{ text: 'Log In / Register', onPress: () => router.replace('/login') }]
                    );
                }, 500);
            }
        }
    };

    const pulseScale = useSharedValue(1);

    useEffect(() => {
        if (visible) {
            pulseScale.value = withRepeat(
                withSequence(
                    withTiming(1.04, { duration: 1000, easing: Easing.bezier(0.4, 0, 0.6, 1) }),
                    withTiming(1, { duration: 1000, easing: Easing.bezier(0.4, 0, 0.6, 1) })
                ),
                -1,
                true
            );
        } else {
            pulseScale.value = 1;
        }
    }, [visible]);

    const pulseStyle = useAnimatedStyle(() => ({
        transform: [{ scale: pulseScale.value }]
    }));

    const features = [
        {
            icon: 'infinite',
            title: 'Unlimited Swipes',
            desc: 'Clean everything in one session. No daily limits.'
        },
        {
            icon: 'ban-outline',
            title: 'Ad-Free Forever',
            desc: 'All ads removed after your first purchase.'
        },
        {
            icon: 'calendar-outline',
            title: 'Smart Filters',
            desc: 'Clean by date, category, or type.'
        },
    ];

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
        >
            <View style={styles.overlay}>
                <BlurView intensity={Platform.OS === 'ios' ? 40 : 100} style={StyleSheet.absoluteFill} tint="dark" />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]} />

                <Animated.View
                    entering={SlideInDown.springify().damping(15)}
                    style={styles.modal}
                >
                    <Pressable style={styles.closeBtn} onPress={onClose}>
                        <Ionicons name="close" size={20} color="#6B7280" />
                    </Pressable>

                    <View style={styles.fixedContent}>
                        {/* HEADER SECTION */}
                        <View style={styles.header}>
                            {reason === 'limit' && (
                                <View style={styles.limitBadge}>
                                    <Ionicons name="alert-circle" size={14} color="#FF6B6B" style={{ marginRight: 4 }} />
                                    <Text style={styles.limitBadgeText}>Daily Limit Reached</Text>
                                </View>
                            )}
                            <Text style={styles.title}>
                                Never run out of swipes again
                            </Text>
                            <Text style={styles.subtitle}>
                                Clean your entire gallery without limits.
                            </Text>
                        </View>

                        {/* FEATURE LIST SECTION */}
                        <View style={styles.featureList}>
                            {features.map((item, index) => (
                                <Animated.View
                                    key={index}
                                    entering={FadeInDown.delay(200 + index * 100).duration(400)}
                                    style={styles.featureCard}
                                >
                                    <View style={styles.featureIconWrap}>
                                        <Ionicons name={item.icon as any} size={24} color="#ff6b6b" />
                                    </View>
                                    <View style={styles.featureText}>
                                        <Text style={styles.featureTitle}>{item.title}</Text>
                                        <Text style={styles.featureDesc} numberOfLines={2}>{item.desc}</Text>
                                    </View>
                                </Animated.View>
                            ))}
                        </View>

                        {/* CTA SECTION */}
                        <View style={styles.ctaSection}>
                            <View style={styles.priceContainer}>
                                <Text style={styles.priceText}>{product?.localizedPrice || '$2.99'}</Text>
                                <Text style={styles.priceSubtext}>One-time · Lifetime access</Text>
                            </View>

                            <Animated.View style={[styles.pulseContainer, pulseStyle]}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.ctaButton,
                                        pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                                        isLoading && styles.ctaDisabled
                                    ]}
                                    onPress={handlePurchase}
                                    disabled={isLoading || !product}
                                >
                                    <View style={[styles.ctaGradient, { backgroundColor: '#FF6B6B', opacity: (!product || isLoading) ? 0.7 : 1 }]}>
                                        {isLoading ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : !product ? (
                                            <Text style={styles.ctaText}>{connError ? 'Retry Connection' : 'Please wait...'}</Text>
                                        ) : (
                                            <Text style={styles.ctaText}>Unlock Unlimited Cleaning</Text>
                                        )}
                                    </View>
                                </Pressable>
                            </Animated.View>

                            {reason === 'limit' && (
                                <View style={{ alignItems: 'center', marginVertical: 8 }}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.rewardButton,
                                            pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
                                            (!rewardedAd || isAdLoading) && { opacity: 0.5 }
                                        ]}
                                        onPress={handleWatchAd}
                                        disabled={!rewardedAd || isAdLoading}
                                    >
                                        <Ionicons name="play-circle-outline" size={20} color="#FF6B6B" style={{ marginRight: 8 }} />
                                        <Text style={styles.rewardText}>
                                            {isAdLoading ? 'Opening...' : rewardedAd ? 'Watch ad for +25 free swipes' : 'Loading ad...'}
                                        </Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>

                        <View style={styles.footerLinks}>
                            <Pressable onPress={handleRestore}>
                                <Text style={styles.footerLinkText}>Restore Purchases</Text>
                            </Pressable>
                        </View>
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modal: {
        width: '94%',
        maxWidth: 500,
        backgroundColor: '#FFFFFF',
        borderRadius: 32,
        padding: 24,
        paddingBottom: 120,
        height: H * 0.78,
        maxHeight: 680,
        borderWidth: 1, borderColor: '#EDEDED',
        shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.15, shadowRadius: 30, elevation: 15,
    },
    pulseContainer: {
        width: '100%',
        alignItems: 'center',
    },
    fixedContent: {
        flex: 1,
        justifyContent: 'flex-start',
        paddingTop: 20,
    },
    closeBtn: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        backgroundColor: '#F8F8FA',
        borderRadius: 20,
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1, borderColor: '#F1F1F1'
    },
    header: {
        alignItems: 'center',
    },
    limitBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF1F1',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        marginBottom: 12,
    },
    limitBadgeText: {
        color: '#FF6B6B',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    title: {
        fontFamily: 'DMSans_700Bold',
        fontSize: 26,
        color: '#1C1C1E',
        textAlign: 'center',
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontFamily: 'DMSans_400Regular',
        fontSize: 15,
        color: '#6B7280',
        textAlign: 'center',
        lineHeight: 20,
    },
    featureList: {
        gap: 10,
        marginVertical: 15,
    },
    featureCard: {
        flexDirection: 'row',
        backgroundColor: '#F8F8FA',
        padding: 12,
        borderRadius: 20,
        alignItems: 'center',
        borderWidth: 1, borderColor: '#F1F1F1',
    },
    featureIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#FFF1F1',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    featureText: {
        flex: 1,
    },
    featureTitle: {
        fontFamily: 'System',
        fontSize: 16,
        fontWeight: '700',
        color: '#1C1C1E',
        marginBottom: 1,
    },
    featureDesc: {
        fontFamily: 'System',
        fontSize: 12,
        color: '#6B7280',
        lineHeight: 16,
    },
    ctaSection: {
        alignItems: 'center',
    },
    priceContainer: {
        alignItems: 'center',
        marginBottom: 12,
    },
    priceText: {
        fontSize: 36,
        fontWeight: '900',
        color: '#1C1C1E',
        fontFamily: 'System',
    },
    priceSubtext: {
        fontSize: 13,
        color: '#6B7280',
        fontFamily: 'System',
    },
    ctaButton: {
        width: '100%',
        height: 58,
        borderRadius: 29,
        overflow: 'hidden',
        shadowColor: '#FF6B6B',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    ctaGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ctaText: {
        fontSize: 17,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    ctaDisabled: {
        opacity: 0.5,
    },
    rewardButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 100,
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#F1F1F1',
        marginTop: 10,
    },
    rewardText: {
        fontFamily: 'System',
        fontSize: 14,
        fontWeight: '700',
        color: '#FF6B6B',
    },
    footerLinks: {
        marginTop: 32,
        paddingBottom: 20,
        alignItems: 'center',
        width: '100%',
    },
    footerLinkText: {
        fontSize: 13,
        color: '#A1A1AA',
        fontWeight: '600',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
});
