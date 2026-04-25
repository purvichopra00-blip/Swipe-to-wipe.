import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IAP from 'react-native-iap';
import Constants from 'expo-constants';

const PRODUCT_ID = 'pro_upgrade';
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
}

const IAPContext = createContext<IAPContextType | undefined>(undefined);

export function IAPProvider({ children }: { children: React.ReactNode }) {
    const [isPro, setIsPro] = useState(false);
    const [photoCount, setPhotoCount] = useState(0);
    const [videoCount, setVideoCount] = useState(0);
    const [product, setProduct] = useState<IAP.Product | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Initial load: Local state + StoreKit Connection
    useEffect(() => {
        let purchaseUpdateSubscription: any;
        let purchaseErrorSubscription: any;

        const init = async () => {
            try {
                // 1. Load local persistence (fast recovery)
                const [storedIsPro, storedPhotoCount, storedVideoCount, storedLastReset] = await Promise.all([
                    AsyncStorage.getItem(IAP_KEYS.IS_PRO),
                    AsyncStorage.getItem(IAP_KEYS.DAILY_PHOTO_COUNT),
                    AsyncStorage.getItem(IAP_KEYS.DAILY_VIDEO_COUNT),
                    AsyncStorage.getItem(IAP_KEYS.LAST_RESET_DATE),
                ]);

                if (storedIsPro === 'true') {
                    setIsPro(true);
                }

                // 2. Handle daily reset
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
                    setPhotoCount(storedPhotoCount ? parseInt(storedPhotoCount, 10) : 0);
                    setVideoCount(storedVideoCount ? parseInt(storedVideoCount, 10) : 0);
                }

                // Safely bypass in Expo Go or Web environments
                const isExpoGo = Constants.appOwnership === 'expo';
                if (isExpoGo) {
                    console.warn('IAP bypassed: Running in Expo Go (Mocking Product Data)');
                    setProduct({
                        productId: PRODUCT_ID,
                        title: 'Swipe to Wipe Pro',
                        description: 'Unlimited swipes and ad-free experience.',
                        price: '4.99',
                        currency: 'USD',
                        localizedPrice: '$4.99'
                    } as any);
                    setIsLoading(false);
                    return;
                }

                // 3. Initialize IAP Connection
                await IAP.initConnection();

                // 4. Set up Listeners (Production Best Practice)
                purchaseUpdateSubscription = IAP.purchaseUpdatedListener(async (purchase: IAP.Purchase) => {
                    const receipt = purchase.transactionReceipt;
                    if (receipt) {
                        try {
                            // Non-consumables should be finished immediately on success
                            await IAP.finishTransaction({ purchase, isConsumable: false });
                            setIsPro(true);
                            await AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                            
                            // ✅ SUCCESS HANDLING MOVED HERE (Apple Requirement)
                            Alert.alert('Success', 'Pro unlocked! You now have unlimited swipes and no ads. 🚀');
                        } catch (err) {
                            console.warn('finishTransaction failed', err);
                        }
                    }
                });

                purchaseErrorSubscription = IAP.purchaseErrorListener((error: IAP.PurchaseError) => {
                    if (error.code !== 'E_USER_CANCELLED') {
                        console.log('Purchase Error Listener:', error.message);
                        Alert.alert('Purchase Error', error.message);
                    }
                });

                // 5. Sync Entitlements (Server Check Fallback)
                // This ensures if user clears storage or reinstalls, they keep Pro status
                if (Platform.OS === 'ios' && IAP.getAvailablePurchases) {
                    const purchases = await IAP.getAvailablePurchases();
                    const hasPro = purchases.some(p => p.productId === PRODUCT_ID);
                    if (hasPro) {
                        setIsPro(true);
                        await AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                    }
                }

                // 6. Fetch Product Info
                if (Platform.OS === 'ios' && IAP.getProducts) {
                    const products = await IAP.getProducts({ skus: [PRODUCT_ID] });
                    if (products && products.length > 0) {
                        setProduct(products[0]);
                    } else {
                        console.log('⚠️ No products loaded');
                        
                        // Only show alert if we are actually viewing the paywall or trying to purchase
                        // To keep it clean, we just log and retry silently first
                        setTimeout(async () => {
                            try {
                                const retryProducts = await IAP.getProducts({ skus: [PRODUCT_ID] });
                                if (retryProducts && retryProducts.length > 0) {
                                    setProduct(retryProducts[0]);
                                } else {
                                    // If even retry fails, we let the paywall's local state handle the "Please wait" 
                                    // and the user can try to tap it which triggers another check.
                                    console.log('⚠️ Retry also returned no products');
                                }
                            } catch (e) {
                                console.log('Retry failed', e);
                            }
                        }, 2000);
                    }
                }
            } catch (err) {
                console.error('IAP Initialization Error:', err);
            } finally {
                setIsLoading(false);
            }
        };

        init();

        return () => {
            if (purchaseUpdateSubscription) purchaseUpdateSubscription.remove();
            if (purchaseErrorSubscription) purchaseErrorSubscription.remove();
            IAP.endConnection();
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

    const purchaseProduct = async () => {
        try {
            setIsLoading(true);
            const isExpoGo = Constants.appOwnership === 'expo';
            if (isExpoGo) {
                Alert.alert('Expo Go MOCK', 'Simulated purchase successful! You are now Pro.');
                setIsPro(true);
                AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                return true;
            }

            // requestPurchase returns the purchase object on iOS
            // andFinishTransactionIOS: false tells IAP NOT to finish it automatically
            // we finish it in the purchaseUpdatedListener
            if (IAP.requestPurchase) {
                await IAP.requestPurchase({ sku: PRODUCT_ID, andFinishTransactionIOS: false });
                return true; // Flow started successfully
            }
        } catch (err: any) {
            if (err.code !== 'E_USER_CANCELLED') {
                Alert.alert('Purchase Failed', err.message);
            }
        } finally {
            setIsLoading(false);
        }
        return false;
    };

    const restorePurchases = async () => {
        try {
            setIsLoading(true);
            const isExpoGo = Constants.appOwnership === 'expo';
            if (isExpoGo) {
                Alert.alert('Expo Go MOCK', 'Simulated restore successful!');
                setIsPro(true);
                AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                return true;
            }

            if (IAP.getAvailablePurchases) {
                const purchases = await IAP.getAvailablePurchases();
                const hasPro = purchases.some(p => p.productId === PRODUCT_ID);
                if (hasPro) {
                    setIsPro(true);
                    await AsyncStorage.setItem(IAP_KEYS.IS_PRO, 'true');
                    Alert.alert('Success', 'Your purchases have been restored!');
                    return true;
                } else {
                    Alert.alert('No Purchases Found', 'We couldn\'t find any previous purchases for this account.');
                }
            }
        } catch (err: any) {
            Alert.alert('Restore Failed', err.message);
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
