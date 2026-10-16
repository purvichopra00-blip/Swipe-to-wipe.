import type { ProductIOS, Purchase } from 'react-native-iap';

export const PRO_PRODUCT_ID = 'pro_upgrade';

/** A native StoreKit/Play result, not a network/server receipt validator. */
export function isCompletedProPurchase(purchase: Purchase): boolean {
    return purchase.productId === PRO_PRODUCT_ID
        && purchase.purchaseState === 'purchased'
        && !('revocationDateIOS' in purchase && purchase.revocationDateIOS != null);
}

/** For Expo Go only; never persist a simulated entitlement or use this price in production. */
export const PREVIEW_PRODUCT: ProductIOS = {
    id: PRO_PRODUCT_ID,
    title: 'Swipe to Wipe Pro (Preview)',
    description: 'Preview only — no real purchase.',
    displayNameIOS: 'Swipe to Wipe Pro (Preview)',
    displayPrice: 'Preview only',
    price: 0,
    currency: 'USD',
    platform: 'ios',
    type: 'in-app',
    typeIOS: 'non-consumable',
    isFamilyShareableIOS: false,
    jsonRepresentationIOS: '{}',
};