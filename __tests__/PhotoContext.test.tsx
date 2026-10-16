import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { PhotoProvider, usePhotos } from '../contexts/PhotoContext';

jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn(async () => true) } }));

const photos = Array.from({ length: 320 }, (_, index) => ({
    id: String(index), uri: `ph://${index}`, mediaType: 'photo',
    filename: `${index}.jpg`, creationTime: Date.now(), modificationTime: Date.now(),
    width: 100, height: 100, duration: 0, albumId: '',
}));
const assetsMock = MediaLibrary.getAssetsAsync as jest.Mock;
const wrapper = ({ children }: { children: React.ReactNode }) => <PhotoProvider>{children}</PhotoProvider>;

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    assetsMock.mockImplementation(async (options: any = {}) => {
        const start = options.after ? Number(options.after) : 0;
        const count = options.first || 200;
        const next = Math.min(start + count, photos.length);
        return { assets: photos.slice(start, next), endCursor: String(next), hasNextPage: next < photos.length, totalCount: photos.length };
    });
});

async function initialized() {
    const hook = renderHook(() => usePhotos(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLoadingSession).toBe(false));
    return hook;
}

test('keeps survive a provider restart; Undo removes the saved keep decision', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('By Date', { year: 2026 }); });
    act(() => { hook.result.current.swipeRight(); });
    await act(async () => { await hook.result.current.endSession(); });
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('@kept_photo_ids_v1'))!)).toEqual(['0']));
    hook.unmount();

    const next = await initialized();
    await act(async () => { await next.result.current.startSwipingSession('By Date', { year: 2026 }); });
    expect(next.result.current.currentPhoto?.id).toBe('1');
    act(() => { next.result.current.swipeRight(); });
    act(() => { next.result.current.undo(); });
    act(() => { next.result.current.endSession(); });
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('@kept_photo_ids_v1'))!)).toEqual(['0']));
    next.unmount();
});

test('restoring the final bin item persists an empty bin without any deletions', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('Recents', null); });
    act(() => { hook.result.current.swipeLeft(); });
    expect(hook.result.current.binPhotos).toHaveLength(1);
    act(() => { hook.result.current.restoreFromBin('0'); });
    act(() => { hook.result.current.endSession(); });
    await waitFor(async () => expect(await AsyncStorage.getItem('@bin_photos_v2')).toBe('[]'));
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
    hook.unmount();
});

test('left-swipe followed by Undo cannot asynchronously re-add the bin item', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('Recents', null); });
    act(() => { hook.result.current.swipeLeft(); });
    act(() => { hook.result.current.undo(); });
    expect(hook.result.current.binPhotos).toHaveLength(0);
    expect(hook.result.current.currentPhoto?.id).toBe('0');
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
    hook.unmount();
});

test('long sessions trim rendered history and guard concurrent pagination', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('Recents', null); });
    for (let index = 0; index < 195; index++) act(() => { hook.result.current.swipeRight(); });
    await waitFor(() => expect(hook.result.current.photos.length).toBeGreaterThan(60));
    await act(async () => {
        await Promise.all([hook.result.current.loadMore(), hook.result.current.loadMore(), hook.result.current.loadMore()]);
    });
    expect(hook.result.current.currentPhoto?.id).toBe('195');
    expect(hook.result.current.currentIndex).toBeLessThan(100);
    expect(hook.result.current.photos.length).toBeLessThan(300);
    expect(new Set(hook.result.current.photos.map(photo => photo.id)).size).toBe(hook.result.current.photos.length);
    const secondPageReads = assetsMock.mock.calls.filter(([options]) => options.after === '200');
    expect(secondPageReads).toHaveLength(1);
    hook.unmount();
});

test('month and media filter options remain fixed for pagination', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('By Date', { year: 2024, month: 1, mediaType: 'photo' }); });
    act(() => { hook.result.current.setDateFilter({ year: 2026, mediaType: 'video' }); });
    await act(async () => { await hook.result.current.loadMore(); });
    const [options] = assetsMock.mock.calls.find(([options]) => options.after === '200')!;
    expect(options.createdAfter).toBe(new Date(2024, 1, 1).getTime());
    expect(options.createdBefore).toBe(new Date(2024, 2, 1).getTime());
    expect(options.mediaType).toEqual(['photo']);
    hook.unmount();
});
test('cancelled expiry retains entries and does not retry on each render', async () => {
    const deletedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await AsyncStorage.setItem('@bin_photos_v2', JSON.stringify([{ id: 'expired', url: 'ph://expired', deletedAt, fileSize: 10 }]));
    (MediaLibrary.deleteAssetsAsync as jest.Mock).mockResolvedValueOnce(false);
    const hook = await initialized();
    await waitFor(() => expect(MediaLibrary.deleteAssetsAsync).toHaveBeenCalledTimes(1));
    expect(hook.result.current.binPhotos.map(photo => photo.id)).toEqual(['expired']);
    act(() => { hook.result.current.setDateFilter({ year: 2024 }); });
    expect(MediaLibrary.deleteAssetsAsync).toHaveBeenCalledTimes(1);
    hook.unmount();
});

test('reset clears persisted keep decisions without an old queued save restoring them', async () => {
    const hook = await initialized();
    await act(async () => { await hook.result.current.startSwipingSession('Recents', null); });
    act(() => { hook.result.current.swipeRight(); });
    await act(async () => { await hook.result.current.deepReset(); });
    act(() => { hook.result.current.endSession(); });
    await waitFor(async () => expect(await AsyncStorage.getItem('@kept_photo_ids_v1')).toBe('[]'));
    await act(async () => { await hook.result.current.startSwipingSession('Recents', null); });
    expect(hook.result.current.currentPhoto?.id).toBe('0');
    hook.unmount();
});
