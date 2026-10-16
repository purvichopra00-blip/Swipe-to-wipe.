import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IAP from 'react-native-iap';
import Constants from 'expo-constants';
import { PRO_PRODUCT_ID as PRODUCT_ID, PREVIEW_PRODUCT, isCompletedProPurchase } from '../lib/purchases';

const IAP_KEYS = {
    IS_PRO: '@iap_is_pro_v1',
    DAILY_PHOTO_COUNT: '@iap_daily_photo_count_v1',
    DAILY_VIDEO_COUNT: '@iap_daily_video_count_v1',
    LAST_RESET_DATE: '@iap_last_reset_date_v1',
};

const LIMITS = {
    TOTAL_SWIPES: 50,
};

interface IAPContextType {
    isPro: boolean;
    photoSwipesRemaining: number;
    videoSwipesRemaining: number;
    product: IAP.Product | null;
    isLoading: boolean;
    purchaseProduct: () => Promise<boolean>;
    restorePurchases: () => Promise<boolean>;
    trackSwipe: (mediaType: 'photo' | 'video') => Promise<void>;
    canSwipe: (mediaType: 'photo' | 'video') => boolean;
    photoCount: number;
    videoCount: number;
    resetDailyLimits: () => Promise<void>;
    addRewardSwipes: () => Promise<void>;
}

const IAPContext = createContext<IAPContextType | undefined>(undefined);

export function IAPProvider({ children }: { children: React.ReactNode }) {
    const [isPro, setIsPro] = useState(false);
    const [photoCount, setPhotoCount] = useState(0);
    const [videoCount, setVideoCount] = useState(0);
    const [product, setProduct] = useState<IAP.Product | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // v15 uses StoreKit 2 events and displayPrice, not the old receipt/getProducts APIs.
    useEffect(() => {
        let active = true;
        let connected = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let purchaseUpdateSubscription: ReturnType<typeof IAP.purchaseUpdatedListener> | undefined;
        let purchaseErrorSubscription: ReturnType<typeof IAP.purchaseErrorListener> | undefined;
        const inFlight = new Set<string>();
        const completed = new Set<string>();
        let purchaseEventVersion = 0;
        const preview = Constants.appOwnership === 'expo';

        const fetchProduct = async (): Promise<boolean> => {
            try {
                const products = await IAP.fetchProducts({ skus: [PRODUCT_ID], type: 'in-app' });
                const candidates: IAP.ProductOrSubscription[] = products ?? [];
                const pro = candidates.find((item): item is IAP.Product => item.type === 'in-app' && item.id === PRODUCT_ID);
                if (active && pro) setProduct(pro);
                return !!pro;
            } catch (error) {
                console.warn('Product fetch failed', error);
                return false;
            }
        };
        const retryProduct = async (remaining: number) => {
            if (!active) return;
            const ok = await fetchProduct();
            if (!ok && active && remaining > 0) {
                retryTimer = setTimeout(() => { void retryProduct(remaining - 1); }, 3000);
            }
        };

        const init = async () => {
            try {
                const [storedIsPro, storedPhotoCount, storedVideoCount, storedLastReset] = await Promise.all([
                    AsyncStorage.getItem(IAP_KEYS.IS_PRO),
                    AsyncStorage.getItem(IAP_KEYS.DAILY_PHOTO_COUNT),
                    AsyncStorage.getItem(IAP_KEYS.DAILY_VIDEO_COUNT),
                    AsyncStorage.getItem(IAP_KEYS.LAST_RESET_DATE),
                ]);
                if (!active) return;
                // Retain cached entitlement while offline; successful store sync below is authoritative.
                if (storedIsPro === 'true') setIsPro(true);
                const today = new Date().toISOString().split('T')[0];
                if (storedLastReset !== today) {
                    setPhotoCount(0);
                    setVideoCount(0);
                    await Promise.all([
                        AsyncStorage.setItem(IAP_KEYS.DAILY_PHOTO_COUNT, '0'),
                        AsyncStorage.setItem(IAP_KEYS.DAILY_VIDEO_COUNT, '0'),
                        AsyncStorage.setItem(IAP_KEYS.LAST_RESET_DATE, today),
                    ]);
                } else {
                    setPhotoCount(Number.parseInt(storedPhotoCount || '0', 10) || 0);
                    setVideoCount(Number.parseInt(storedVideoCount || '0', 10) || 0);
                }
                if (!active) return;
                if (preview) {
                    setProduct(PREVIEW_PRODUCT);
                    return;
                }
                if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

                try {
                    connected = await IAP.initConnection();
                } catch (error) {
                    console.warn('First IAP connection failed, retrying...', error);
                    if (!active) return;
                    connected = await IAP.initConnection();
                }
                if (!connected) throw new Error('The store connection is unavailable.');
                if (!active) {
                    await IAP.endConnection();
                    connected = false;
                    return;
                }

                purchaseUpdateSubscription = IAP.purchaseUpdatedListener(async (purchase) => {
                    if (!active || !isCompletedProPurchase(purchase)) return;
                    const transaction = purchase.id;
                    if (inFlight.has(transaction) || completed.has(transaction)) return;
                    inFlight.add(transaction);
                    purchaseEventVersion++;
                    try {
                        // Persist the native completed entitlement before acknowledging the transaction.
                        await AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                        await IAP.finishTransaction({ purchase, isConsumable: false });
                        completed.add(transaction);
                        if (active) {
                            setIsPro(true);
                            Alert.alert('Success', 'Pro unlocked! You now have unlimited swipes and no ads. 🚀');
                        }
                    } catch (error) {
                        console.warn('Purchase completion failed; native redelivery can retry.', error);
                    } finally {
                        inFlight.delete(transaction);
                    }
                });
                purchaseErrorSubscription = IAP.purchaseErrorListener((error) => {
                    if (active && error.code !== IAP.ErrorCode.UserCancelled) {
                        Alert.alert('Purchase Error', error.message);
                    }
                });

                // A store/network error does not revoke an offline cached entitlement.
                try {
                    const versionBeforeSync = purchaseEventVersion;
                    const purchases = await IAP.getAvailablePurchases();
                    const hasPro = purchases.some(isCompletedProPurchase);
                    if (active && versionBeforeSync === purchaseEventVersion) {
                        await AsyncStorage.setItem(IAP_KEYS.IS_PRO, String(hasPro));
                        if (active) setIsPro(hasPro);
                    }
                } catch (error) {
                    console.warn('Entitlement sync unavailable; retaining local cache.', error);
                }
                if (active) await retryProduct(3);
            } catch (error) {
                console.warn('IAP initialization failed', error);
            } finally {
                if (active) setIsLoading(false);
            }
        };
        void init();
        return () => {
            active = false;
            if (retryTimer) clearTimeout(retryTimer);
            purchaseUpdateSubscription?.remove();
            purchaseErrorSubscription?.remove();
            if (connected) {
                void IAP.endConnection().catch(error => console.warn('IAP disconnect failed', error));
            }
        };
    }, []);

    const canSwipe = useCallback((mediaType: 'photo' | 'video') => {
        if (isPro) return true;
        const totalSwipes = photoCount + videoCount;
        return totalSwipes < LIMITS.TOTAL_SWIPES;
    }, [isPro, photoCount, videoCount]);

    const trackSwipe = useCallback(async (mediaType: 'photo' | 'video') => {
        if (isPro) return;

        if (mediaType === 'photo') {
            setPhotoCount(prev => {
                const next = prev + 1;
                AsyncStorage.setItem(IAP_KEYS.DAILY_PHOTO_COUNT, next.toString());
                return next;
            });
        } else {
            setVideoCount(prev => {
                const next = prev + 1;
                AsyncStorage.setItem(IAP_KEYS.DAILY_VIDEO_COUNT, next.toString());
                return next;
            });
        }
    }, [isPro]);

    const addRewardSwipes = useCallback(async () => {
        let toDeduct = 25;
        let newPhoto = photoCount;
        let newVideo = videoCount;

        if (newPhoto >= toDeduct) {
            newPhoto -= toDeduct;
            toDeduct = 0;
        } else {
            toDeduct -= newPhoto;
            newPhoto = 0;
        }

        if (newVideo >= toDeduct) {
            newVideo -= toDeduct;
            toDeduct = 0;
        } else {
            newVideo = 0;
        }

        setPhotoCount(newPhoto);
        setVideoCount(newVideo);
        await AsyncStorage.setItem(IAP_KEYS.DAILY_PHOTO_COUNT, newPhoto.toString());
        await AsyncStorage.setItem(IAP_KEYS.DAILY_VIDEO_COUNT, newVideo.toString());
    }, [photoCount, videoCount]);

    const purchaseProduct = async (): Promise<boolean> => {
        try {
            setIsLoading(true);
            if (Constants.appOwnership === 'expo') {
                Alert.alert('Expo Go Preview', 'Simulated purchase — no charge or saved Pro entitlement.');
                setIsPro(true);
                return true;
            }
            if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
            // Resolving this call only means the flow started. Only completed purchase events unlock Pro.
            await IAP.requestPurchase({
                type: 'in-app',
                request: {
                    apple: { sku: PRODUCT_ID, andDangerouslyFinishTransactionAutomatically: false },
                    google: { skus: [PRODUCT_ID] },
                },
            });
            return true;
        } catch (error: unknown) {
            const purchaseError = error as Partial<IAP.PurchaseError>;
            if (purchaseError.code !== IAP.ErrorCode.UserCancelled) {
                Alert.alert('Purchase Failed', purchaseError.message || 'Could not start the purchase. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    const restorePurchases = async (): Promise<boolean> => {
        try {
            setIsLoading(true);
            if (Constants.appOwnership === 'expo') {
                Alert.alert('Expo Go Preview', 'Simulated restore — no saved Pro entitlement.');
                setIsPro(true);
                return true;
            }
            if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false;
            // User-initiated restore triggers StoreKit sync; ordinary startup does not prompt.
            await IAP.restorePurchases();
            const purchases = await IAP.getAvailablePurchases();
            const hasPro = purchases.some(isCompletedProPurchase);
            await AsyncStorage.setItem(IAP_KEYS.IS_PRO, String(hasPro));
            setIsPro(hasPro);
            if (hasPro) {
                Alert.alert('Success', 'Your purchases have been restored!');
                return true;
            }
            Alert.alert('No Purchases Found', 'We could not find a completed Pro purchase for this store account.');
        } catch (error: unknown) {
            Alert.alert('Restore Failed', error instanceof Error ? error.message : 'Could not restore purchases. Please try again.');
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    const resetDailyLimits = useCallback(async () => {
        const today = new Date().toISOString().split('T')[0];
        // Hard reset to 0
        setPhotoCount(0);
        setVideoCount(0);

        try {
            await Promise.all([
                AsyncStorage.setItem(IAP_KEYS.DAILY_PHOTO_COUNT, '0'),
                AsyncStorage.setItem(IAP_KEYS.DAILY_VIDEO_COUNT, '0'),
                AsyncStorage.setItem(IAP_KEYS.LAST_RESET_DATE, today),
            ]);
            console.log('--- TESTER: DAILY SWIPE LIMITS RESET TO 0 ---');
        } catch (e) {
            console.error('Reset storage failed', e);
        }
    }, []);

    const totalSwipes = photoCount + videoCount;
    const photoSwipesRemaining = Math.max(0, LIMITS.TOTAL_SWIPES - totalSwipes);
    const videoSwipesRemaining = Math.max(0, LIMITS.TOTAL_SWIPES - totalSwipes);

    const value = useMemo(() => ({
        isPro,
        photoSwipesRemaining,
        videoSwipesRemaining,
        photoCount,
        videoCount,
        product,
        isLoading,
        purchaseProduct,
        restorePurchases,
        trackSwipe,
        canSwipe,
        resetDailyLimits,
        addRewardSwipes,
    }), [isPro, photoSwipesRemaining, videoSwipesRemaining, photoCount, videoCount, product, isLoading, purchaseProduct, restorePurchases, trackSwipe, canSwipe, resetDailyLimits, addRewardSwipes]);

    return (
        <IAPContext.Provider value={value}>
            {children}
        </IAPContext.Provider>
    );
}

export function useIAP() {
    const context = useContext(IAPContext);
    if (!context) throw new Error('useIAP must be used within an IAPProvider');
    return context;
}
