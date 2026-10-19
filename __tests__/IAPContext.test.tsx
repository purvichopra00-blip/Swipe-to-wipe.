import React from 'react';
import { Alert, Platform } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as IAP from 'react-native-iap';
import { IAPProvider, useIAP } from '../contexts/IAPContext';
import { PREVIEW_PRODUCT, isCompletedProPurchase } from '../lib/purchases';

jest.mock('expo-constants', () => ({
    __esModule: true, default: { appOwnership: 'standalone' },
}));
jest.mock('react-native-iap', () => ({
    ErrorCode: { UserCancelled: 'user-cancelled' },
    initConnection: jest.fn(),
    endConnection: jest.fn(),
    fetchProducts: jest.fn(),
    getAvailablePurchases: jest.fn(),
    restorePurchases: jest.fn(),
    purchaseUpdatedListener: jest.fn(),
    purchaseErrorListener: jest.fn(),
    requestPurchase: jest.fn(),
    finishTransaction: jest.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <IAPProvider>{children}</IAPProvider>;
const removeUpdate = jest.fn();
const removeError = jest.fn();
const paidPurchase: IAP.PurchaseIOS = {
    id: 'transaction-1', transactionId: 'transaction-1',
    productId: 'pro_upgrade', purchaseState: 'purchased',
    platform: 'ios', store: 'apple', quantity: 1,
    isAutoRenewing: false, transactionDate: 100,
};
const getPurchases = IAP.getAvailablePurchases as jest.MockedFunction<typeof IAP.getAvailablePurchases>;
const fetchProducts = IAP.fetchProducts as jest.MockedFunction<typeof IAP.fetchProducts>;
const finish = IAP.finishTransaction as jest.MockedFunction<typeof IAP.finishTransaction>;
const requestPurchase = IAP.requestPurchase as jest.MockedFunction<typeof IAP.requestPurchase>;
let alert: jest.SpyInstance;

beforeEach(async () => {
    jest.clearAllMocks();
    for (const value of Object.values(IAP)) {
        if (jest.isMockFunction(value)) value.mockReset();
    }
    await AsyncStorage.clear();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    Object.defineProperty(Constants, 'appOwnership', { configurable: true, value: 'standalone' });
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (IAP.initConnection as jest.Mock).mockResolvedValue(true);
    (IAP.endConnection as jest.Mock).mockResolvedValue(true);
    fetchProducts.mockResolvedValue([{ ...PREVIEW_PRODUCT, displayPrice: '₹299.00' }]);
    getPurchases.mockResolvedValue([]);
    (IAP.restorePurchases as jest.Mock).mockResolvedValue(undefined);
    finish.mockResolvedValue(undefined);
    requestPurchase.mockResolvedValue(null);
    (IAP.purchaseUpdatedListener as jest.Mock).mockReturnValue({ remove: removeUpdate });
    (IAP.purchaseErrorListener as jest.Mock).mockReturnValue({ remove: removeError });
});
afterEach(() => {
    alert.mockRestore();
    jest.useRealTimers();
});

async function initialized() {
    const hook = renderHook(() => useIAP(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
}
function updateListener() {
    return (IAP.purchaseUpdatedListener as jest.MockedFunction<typeof IAP.purchaseUpdatedListener>).mock.calls[0][0];
}
function errorListener() {
    return (IAP.purchaseErrorListener as jest.MockedFunction<typeof IAP.purchaseErrorListener>).mock.calls[0][0];
}

test('loads the configured in-app SKU through v15 and exposes its store-localized price', async () => {
    const hook = await initialized();
    expect(fetchProducts).toHaveBeenCalledWith({ skus: ['pro_upgrade'], type: 'in-app' });
    expect(hook.result.current.product?.id).toBe('pro_upgrade');
    expect(hook.result.current.product?.displayPrice).toBe('₹299.00');
    expect(hook.result.current.isPro).toBe(false);
    hook.unmount();
    expect(removeUpdate).toHaveBeenCalledTimes(1);
    expect(removeError).toHaveBeenCalledTimes(1);
    expect(IAP.endConnection).toHaveBeenCalledTimes(1);
});

test('purchase request uses v15 platform payload and cannot itself unlock Pro', async () => {
    const hook = await initialized();
    let started;
    await act(async () => { started = await hook.result.current.purchaseProduct(); });
    expect(started).toBe(true);
    expect(requestPurchase).toHaveBeenCalledWith({
        type: 'in-app', request: {
            apple: { sku: 'pro_upgrade', andDangerouslyFinishTransactionAutomatically: false },
            google: { skus: ['pro_upgrade'] },
        },
    });
    expect(hook.result.current.isPro).toBe(false);
    expect(finish).not.toHaveBeenCalled();
    hook.unmount();
});

test('completed matching purchase without legacy receipt persists and finishes once', async () => {
    const hook = await initialized();
    await act(async () => {
        await updateListener()(paidPurchase);
        await updateListener()(paidPurchase);
    });
    expect(hook.result.current.isPro).toBe(true);
    expect(await AsyncStorage.getItem('@iap_is_pro_v1')).toBe('true');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({ purchase: paidPurchase, isConsumable: false });
    hook.unmount();
});

test.each([
    ['pending', { ...paidPurchase, purchaseState: 'pending' as const }],
    ['unknown', { ...paidPurchase, purchaseState: 'unknown' as const }],
    ['unrelated SKU', { ...paidPurchase, productId: 'unrelated' }],
    ['revoked', { ...paidPurchase, revocationDateIOS: 500 }],
])('%s purchase does not unlock or finish', async (_name, purchase) => {
    const hook = await initialized();
    await act(async () => { await updateListener()(purchase); });
    expect(hook.result.current.isPro).toBe(false);
    expect(finish).not.toHaveBeenCalled();
    hook.unmount();
});

test('listener cancellation and rejected request cancellation are silent', async () => {
    const hook = await initialized();
    act(() => { errorListener()({ code: IAP.ErrorCode.UserCancelled, message: 'Cancelled' }); });
    requestPurchase.mockRejectedValueOnce({ code: IAP.ErrorCode.UserCancelled, message: 'Cancelled' });
    let started;
    await act(async () => { started = await hook.result.current.purchaseProduct(); });
    expect(started).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    expect(hook.result.current.isPro).toBe(false);
    hook.unmount();
});

test('non-cancellation purchase errors are surfaced without unlocking', async () => {
    const hook = await initialized();
    requestPurchase.mockRejectedValueOnce(new Error('Store unavailable'));
    await act(async () => { await hook.result.current.purchaseProduct(); });
    expect(alert).toHaveBeenCalledWith('Purchase Failed', 'Store unavailable');
    expect(hook.result.current.isPro).toBe(false);
    hook.unmount();
});

test('restore accepts only completed nonrevoked Pro and clears a stale cache on successful no-purchase result', async () => {
    const hook = await initialized();
    getPurchases.mockResolvedValueOnce([paidPurchase]);
    let restored;
    await act(async () => { restored = await hook.result.current.restorePurchases(); });
    expect(restored).toBe(true);
    expect(IAP.restorePurchases).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isPro).toBe(true);
    getPurchases.mockResolvedValueOnce([{ ...paidPurchase, purchaseState: 'pending' }]);
    await act(async () => { restored = await hook.result.current.restorePurchases(); });
    expect(restored).toBe(false);
    expect(hook.result.current.isPro).toBe(false);
    expect(await AsyncStorage.getItem('@iap_is_pro_v1')).toBe('false');
    hook.unmount();
});

test('store sync and restore network failures preserve cached Pro', async () => {
    await AsyncStorage.setItem('@iap_is_pro_v1', 'true');
    getPurchases.mockRejectedValue(new Error('Offline'));
    const hook = await initialized();
    expect(hook.result.current.isPro).toBe(true);
    await act(async () => { await hook.result.current.restorePurchases(); });
    expect(hook.result.current.isPro).toBe(true);
    expect(await AsyncStorage.getItem('@iap_is_pro_v1')).toBe('true');
    hook.unmount();
});

test('transaction finish failure does not celebrate; redelivery can retry', async () => {
    const hook = await initialized();
    finish.mockRejectedValueOnce(new Error('Native finish unavailable'));
    await act(async () => { await updateListener()(paidPurchase); });
    expect(alert).not.toHaveBeenCalled();
    expect(hook.result.current.isPro).toBe(false);
    await act(async () => { await updateListener()(paidPurchase); });
    expect(hook.result.current.isPro).toBe(true);
    expect(finish).toHaveBeenCalledTimes(2);
    hook.unmount();
});

test('Expo Go preview cannot save a paid entitlement or use real store APIs', async () => {
    Object.defineProperty(Constants, 'appOwnership', { configurable: true, value: 'expo' });
    const hook = await initialized();
    await act(async () => { await hook.result.current.purchaseProduct(); });
    await act(async () => { await hook.result.current.restorePurchases(); });
    expect(hook.result.current.isPro).toBe(true);
    expect(await AsyncStorage.getItem('@iap_is_pro_v1')).toBeNull();
    expect(IAP.initConnection).not.toHaveBeenCalled();
    expect(requestPurchase).not.toHaveBeenCalled();
    hook.unmount();
    expect(IAP.endConnection).not.toHaveBeenCalled();
});

test('product retry timer is cancelled on unmount', async () => {
    jest.useFakeTimers();
    fetchProducts.mockResolvedValue([]);
    const hook = await initialized();
    const calls = fetchProducts.mock.calls.length;
    hook.unmount();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(fetchProducts).toHaveBeenCalledTimes(calls);
});

test('rewarded swipes expose the typed action and preserve combined daily budget', async () => {
    await AsyncStorage.multiSet([
        ['@iap_daily_photo_count_v1', '35'], ['@iap_daily_video_count_v1', '15'],
        ['@iap_last_reset_date_v1', new Date().toISOString().split('T')[0]],
    ]);
    const hook = await initialized();
    expect(hook.result.current.canSwipe('photo')).toBe(false);
    await act(async () => { await hook.result.current.addRewardSwipes(); });
    expect(hook.result.current.photoCount + hook.result.current.videoCount).toBe(25);
    expect(hook.result.current.photoSwipesRemaining).toBe(25);
    hook.unmount();
});

test('a completed purchase arriving during startup sync is not overwritten by stale empty results', async () => {
    let resolveSync!: (purchases: IAP.Purchase[]) => void;
    getPurchases.mockImplementationOnce(() => new Promise(resolve => { resolveSync = resolve; }));
    const hook = renderHook(() => useIAP(), { wrapper });
    await waitFor(() => expect(IAP.purchaseUpdatedListener).toHaveBeenCalled());
    await act(async () => { await updateListener()(paidPurchase); });
    await act(async () => { resolveSync([]); });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(hook.result.current.isPro).toBe(true);
    expect(await AsyncStorage.getItem('@iap_is_pro_v1')).toBe('true');
    hook.unmount();
});

test('native completion classifier never treats a different SKU as Pro', () => {
    expect(isCompletedProPurchase(paidPurchase)).toBe(true);
    expect(isCompletedProPurchase({ ...paidPurchase, productId: 'other' })).toBe(false);
});
test('a duplicated concurrent purchase event cannot finish twice', async () => {
    const hook = await initialized();
    await act(async () => {
        await Promise.all([updateListener()(paidPurchase), updateListener()(paidPurchase)]);
    });
    expect(finish).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    hook.unmount();
});

test('failed store sync during restore retains the existing entitlement', async () => {
    getPurchases.mockResolvedValue([paidPurchase]);
    const hook = await initialized();
    (IAP.restorePurchases as jest.Mock).mockRejectedValueOnce(new Error('Sync unavailable'));
    await act(async () => { await hook.result.current.restorePurchases(); });
    expect(hook.result.current.isPro).toBe(true);
    expect(alert).toHaveBeenCalledWith('Restore Failed', 'Sync unavailable');
    hook.unmount();
});

test('unmount during connection initialization disconnects without attaching late listeners', async () => {
    let resolveConnection!: (connected: boolean) => void;
    (IAP.initConnection as jest.Mock).mockImplementationOnce(
        () => new Promise(resolve => { resolveConnection = resolve; }),
    );
    const hook = renderHook(() => useIAP(), { wrapper });
    await waitFor(() => expect(IAP.initConnection).toHaveBeenCalledTimes(1));
    hook.unmount();
    await act(async () => { resolveConnection(true); });
    expect(IAP.purchaseUpdatedListener).not.toHaveBeenCalled();
    expect(IAP.endConnection).toHaveBeenCalledTimes(1);
});

test('unsuccessful store connection does not attach purchase listeners', async () => {
    (IAP.initConnection as jest.Mock).mockResolvedValueOnce(false);
    const hook = await initialized();
    expect(hook.result.current.product).toBeNull();
    expect(IAP.purchaseUpdatedListener).not.toHaveBeenCalled();
    hook.unmount();
});
