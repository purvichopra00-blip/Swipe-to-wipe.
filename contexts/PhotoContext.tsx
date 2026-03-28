import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { ActionSheetIOS, Platform, LogBox } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Photo } from '../constants/photos';

// Suppress known non-critical library warnings from being visible to user
LogBox.ignoreLogs([
    'Encountered two children with the same key',
    'VirtualizedLists should never be nested',
    'Possible Unhandled Promise Rejection'
]);

export type SortMode = 'newest' | 'oldest' | 'largest';

export interface BinPhoto extends Photo {
    deletedAt: number; // timestamp ms
    fileSize?: number;
}

export interface CategoryCounts {
    total: number;
    photos: number;
    videos: number;
    screenshots: number;
    recents: number;
}

export interface SessionStats {
    swiped: number;
    kept: number;
    deleted: number;
    mbFreed: number;
}

interface UndoEntry {
    photo: Photo;
    action: 'keep' | 'bin';
    fileSize?: number;
}

interface PhotoContextType {
    photos: Photo[];
    currentIndex: number;
    keptPhotos: Photo[];
    binPhotos: BinPhoto[];
    currentPhoto: Photo | null;
    remainingCount: number;
    canUndo: boolean;
    permissionsGranted: boolean;
    isLoading: boolean;
    isLoadingSession: boolean;
    categoryCounts: CategoryCounts;
    binStorageBytes: number;
    sortMode: SortMode;
    hasMore: boolean;
    sessionStats: SessionStats;
    setSortMode: (mode: SortMode) => void;
    swipeRight: () => void;
    swipeLeft: () => void;
    undo: () => void;
    commitDeletions: (ids?: string[]) => Promise<void>;
    restoreFromBin: (id: string) => void;
    startSwipingSession: (category: string) => Promise<void>;
    loadMore: () => Promise<void>;
    endSession: () => void;
    loadCategoryStats: () => Promise<void>;
    totalClearedBytes: number;
    totalDeletedPhotos: number;
    showIntro: boolean;
    setShowIntro: (show: boolean) => void;
    deepReset: () => Promise<void>;
    userToken: string | null;
    isGuest: boolean;
    setUserToken: (token: string | null) => void;
}

const PhotoContext = createContext<PhotoContextType | undefined>(undefined);

const BATCH_SIZE = 100000;
const PRELOAD_AHEAD = 3;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BIN_STORAGE_KEY = '@bin_photos_v2';
const TOTAL_CLEARED_KEY = '@total_cleared_bytes_v2';
const TOTAL_DELETED_KEY = '@total_deleted_photos_v2';

export function PhotoProvider({ children }: { children: ReactNode }) {
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingSession, setIsLoadingSession] = useState(false);
    const [categoryCounts, setCategoryCounts] = useState<CategoryCounts>({
        total: 0, photos: 0, videos: 0, screenshots: 0, recents: 0
    });

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [keptPhotos, setKeptPhotos] = useState<Photo[]>([]);
    const [binPhotos, setBinPhotos] = useState<BinPhoto[]>([]);
    const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
    const [binStorageBytes, setBinStorageBytes] = useState(0);
    const [sortMode, setSortMode] = useState<SortMode>('newest');
    const [hasMore, setHasMore] = useState(false);
    const [sessionStats, setSessionStats] = useState<SessionStats>({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
    const [totalClearedBytes, setTotalClearedBytes] = useState(0);
    const [totalDeletedPhotos, setTotalDeletedPhotos] = useState(0);
    const [showIntro, setShowIntro] = useState(true);
    const [userToken, setUserToken] = useState<string | null>(null);
    const isGuest = userToken === 'guest';

    const [screenshotAlbumId, setScreenshotAlbumId] = useState<string | null>(null);
    const cursorRef = useRef<string | undefined>(undefined);
    const activeCategoryRef = useRef<string>('Random');

    // Initial load: Permissions + Persistent State
    useEffect(() => {
        (async () => {
            const { status, accessPrivileges } = await MediaLibrary.getPermissionsAsync();
            if (status === 'granted' || (Platform.OS === 'ios' && accessPrivileges === 'all') || (Platform.OS === 'ios' && accessPrivileges === 'limited')) {
                setPermissionsGranted(true);
                loadCategoryStats();
            } else if (status === 'undetermined') {
                const req = await MediaLibrary.requestPermissionsAsync();
                if (req.status === 'granted') {
                    setPermissionsGranted(true);
                    loadCategoryStats();
                } else {
                    setIsLoading(false);
                }
            } else {
                setPermissionsGranted(false);
                setIsLoading(false);
            }

            // Load persistent bin + stats
            try {
                const [storedBin, storedTotal, storedCount, storedToken] = await Promise.all([
                    AsyncStorage.getItem(BIN_STORAGE_KEY),
                    AsyncStorage.getItem(TOTAL_CLEARED_KEY),
                    AsyncStorage.getItem(TOTAL_DELETED_KEY),
                    AsyncStorage.getItem('@auth_token_v1')
                ]);
                if (storedBin) setBinPhotos(JSON.parse(storedBin));
                if (storedTotal) setTotalClearedBytes(parseInt(storedTotal, 10));
                if (storedCount) setTotalDeletedPhotos(parseInt(storedCount, 10));
                if (storedToken) setUserToken(storedToken);
            } catch (err) {
                console.error('Persistence load error', err);
            }
        })();
    }, []);

    // Auto-save bin to persistent storage
    useEffect(() => {
        if (binPhotos.length > 0 || totalClearedBytes > 0) {
            AsyncStorage.setItem(BIN_STORAGE_KEY, JSON.stringify(binPhotos)).catch(() => { });
        }
    }, [binPhotos]);

    useEffect(() => {
        if (totalClearedBytes > 0) {
            AsyncStorage.setItem(TOTAL_CLEARED_KEY, totalClearedBytes.toString()).catch(() => { });
        }
    }, [totalClearedBytes]);

    useEffect(() => {
        if (totalDeletedPhotos > 0) {
            AsyncStorage.setItem(TOTAL_DELETED_KEY, totalDeletedPhotos.toString()).catch(() => { });
        }
    }, [totalDeletedPhotos]);

    // Recalculate Bin Storage size
    useEffect(() => {
        let isMounted = true;
        const calculateBinSize = async () => {
            let total = 0;
            for (const asset of binPhotos) {
                if (asset.fileSize) {
                    total += asset.fileSize;
                } else {
                    try {
                        const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: false });
                        let sz = 0;
                        if (info.localUri || info.uri) {
                            const fi = await FileSystem.getInfoAsync(info.localUri || info.uri);
                            if (fi.exists && !fi.isDirectory) sz = (fi as any).size ?? 0;
                        }
                        total += sz || (asset.mediaType === 'video' ? 15 * 1024 * 1024 : 3 * 1024 * 1024);
                    } catch { /* ignore */ }
                }
            }
            if (isMounted) setBinStorageBytes(total);
        };
        calculateBinSize();

        // Expire items older than 7 days
        const now = Date.now();
        const expired = binPhotos.filter(p => now - p.deletedAt > SEVEN_DAYS_MS);
        if (expired.length > 0) {
            const expiredIds = expired.map(p => p.id);
            MediaLibrary.deleteAssetsAsync(expiredIds).catch(() => { });
            setBinPhotos(prev => prev.filter(p => now - p.deletedAt <= SEVEN_DAYS_MS));
        }

        return () => { isMounted = false; };
    }, [binPhotos]);

    // Preload Logic
    useEffect(() => {
        const preload = async () => {
            if (photos.length === 0) return;
            for (let i = 1; i <= PRELOAD_AHEAD; i++) {
                const upcoming = photos[currentIndex + i];
                if (upcoming?.url) Image.prefetch(upcoming.url).catch(() => { });
            }
            if (hasMore && photos.length - currentIndex <= 10 && !isLoadingSession) {
                loadMore();
            }
        };
        preload();
    }, [currentIndex, photos]);

    const getSortBy = (mode: SortMode): any => {
        if (mode === 'oldest') return [[MediaLibrary.SortBy.creationTime, true]];
        return [MediaLibrary.SortBy.creationTime];
    };

    const mapAssets = async (assets: MediaLibrary.Asset[]): Promise<Photo[]> => {
        const mapped = await Promise.all(assets.map(async (asset) => {
            let fileSize = 0;
            if (sortMode === 'largest') {
                try {
                    const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: false });
                    const fi = await FileSystem.getInfoAsync(info.localUri || info.uri);
                    if (fi.exists && !fi.isDirectory) fileSize = (fi as any).size ?? 0;
                } catch { /* ignore */ }
            }
            return {
                id: asset.id, url: asset.uri, mediaType: asset.mediaType,
                duration: asset.duration, creationTime: asset.creationTime,
                modificationTime: asset.modificationTime, filename: asset.filename, fileSize,
            };
        }));
        if (sortMode === 'largest') return mapped.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
        return mapped;
    };

    const fetchBatch = async (category: string, after?: string) => {
        const sortBy = getSortBy(sortMode);
        const base = { first: BATCH_SIZE, sortBy, after };
        try {
            let result: MediaLibrary.PagedInfo<MediaLibrary.Asset>;
            if (category === 'Videos') result = await MediaLibrary.getAssetsAsync({ ...base, mediaType: MediaLibrary.MediaType.video });
            else if (category === 'Screenshots' && screenshotAlbumId) result = await MediaLibrary.getAssetsAsync({ ...base, album: screenshotAlbumId });
            else result = await MediaLibrary.getAssetsAsync(base);

            // Deduplicate incoming assets by ID immediately
            const seen = new Set();
            const uniqueAssets = result.assets.filter(a => {
                if (seen.has(a.id)) return false;
                seen.add(a.id);
                return true;
            });

            return { assets: uniqueAssets, endCursor: result.endCursor, hasNextPage: result.hasNextPage };
        } catch (err) {
            console.error('fetchBatch error', err);
            return { assets: [], hasNextPage: false };
        }
    };

    const loadCategoryStats = useCallback(async () => {
        setIsLoading(true);
        try {
            const [allMedia, videos, albums] = await Promise.all([
                MediaLibrary.getAssetsAsync({ first: 1 }),
                MediaLibrary.getAssetsAsync({ mediaType: MediaLibrary.MediaType.video, first: 1 }),
                MediaLibrary.getAlbumsAsync()
            ]);
            const screenshotsAlbum = albums.find(a => a.title.toLowerCase().includes('screenshot') || a.title.toLowerCase().includes('capture'));
            if (screenshotsAlbum) setScreenshotAlbumId(screenshotsAlbum.id);

            setCategoryCounts({
                total: allMedia.totalCount || 0,
                photos: Math.max(0, (allMedia.totalCount || 0) - (videos.totalCount || 0)),
                videos: videos.totalCount || 0,
                recents: Math.min(allMedia.totalCount || 0, 100),
                screenshots: screenshotsAlbum?.assetCount ?? 0,
            });
        } catch (error) {
            console.error('Error loading stats:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const startSwipingSession = useCallback(async (category: string) => {
        setIsLoadingSession(true);
        setCurrentIndex(0);
        setUndoStack([]);
        cursorRef.current = undefined;
        activeCategoryRef.current = category;

        const { assets, endCursor, hasNextPage } = await fetchBatch(category);

        // Robust filtering against existing bin/kept IDs
        const ignoredIds = new Set([...keptPhotos.map(p => p.id), ...binPhotos.map(p => p.id)]);
        const filtered = assets.filter(a => !ignoredIds.has(a.id));

        if (category === 'Random') filtered.sort(() => 0.5 - Math.random());

        const mapped = await mapAssets(filtered);
        setPhotos(mapped);
        cursorRef.current = endCursor;
        setHasMore(hasNextPage);
        setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        setIsLoadingSession(false);
    }, [keptPhotos, binPhotos, sortMode, screenshotAlbumId]);

    const loadMore = useCallback(async () => {
        if (!hasMore || !cursorRef.current || isLoadingSession) return;
        const { assets, endCursor, hasNextPage } = await fetchBatch(activeCategoryRef.current, cursorRef.current);

        const currentIds = new Set(photos.map(p => p.id));
        const ignoredIds = new Set([...keptPhotos.map(p => p.id), ...binPhotos.map(p => p.id)]);

        const filtered = assets.filter(a => !currentIds.has(a.id) && !ignoredIds.has(a.id));
        const mapped = await mapAssets(filtered);

        setPhotos(prev => [...prev, ...mapped]);
        cursorRef.current = endCursor;
        setHasMore(hasNextPage);
    }, [hasMore, photos, keptPhotos, binPhotos, sortMode, isLoadingSession]);

    const endSession = useCallback(() => {
        setPhotos([]);
        setCurrentIndex(0);
        setUndoStack([]);
        cursorRef.current = undefined;
        setHasMore(false);
    }, []);

    const commitDeletions = useCallback(async (ids?: string[]) => {
        const toDelete = ids ?? binPhotos.map(p => p.id);
        if (toDelete.length === 0) return;

        const bytesToDelete = ids
            ? binPhotos.filter(p => ids.includes(p.id)).reduce((acc, p) => acc + (p.fileSize || 0), 0)
            : binStorageBytes;

        try {
            const deleted = await MediaLibrary.deleteAssetsAsync(toDelete);
            if (deleted) {
                const newTotalBytes = totalClearedBytes + bytesToDelete;
                const newTotalPhotos = totalDeletedPhotos + toDelete.length;
                setTotalClearedBytes(newTotalBytes);
                setTotalDeletedPhotos(newTotalPhotos);
                setBinPhotos(prev => ids ? prev.filter(p => !ids.includes(p.id)) : []);
                if (!ids) setBinStorageBytes(0);
                loadCategoryStats();
            }
        } catch (error) {
            console.error('Batch deletion error', error);
        }
    }, [binPhotos, binStorageBytes, totalClearedBytes, loadCategoryStats]);

    const restoreFromBin = useCallback((id: string) => {
        setBinPhotos(prev => prev.filter(p => p.id !== id));
    }, []);

    const currentPhoto = (currentIndex >= 0 && currentIndex < photos.length) ? photos[currentIndex] : null;
    const remainingCount = Math.max(0, photos.length - currentIndex);
    const canUndo = undoStack.length > 0;

    const swipeRight = useCallback(() => {
        if (currentIndex < 0 || currentIndex >= photos.length) return;
        const photo = photos[currentIndex];
        setKeptPhotos(prev => [photo, ...prev]);
        setUndoStack(prev => [...prev, { photo, action: 'keep' }]);
        setCurrentIndex(prev => prev + 1);
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, kept: s.kept + 1 }));
    }, [currentIndex, photos]);

    const swipeLeft = useCallback(async () => {
        if (currentIndex < 0 || currentIndex >= photos.length) return;
        const photo = photos[currentIndex];

        let fileSize = photo.fileSize || 0;
        if (!fileSize) {
            try {
                const info = await MediaLibrary.getAssetInfoAsync(photo.id, { shouldDownloadFromNetwork: false });
                const fi = await FileSystem.getInfoAsync(info.localUri || info.uri);
                if (fi.exists && !fi.isDirectory) fileSize = (fi as any).size ?? 0;
            } catch { /* ignore */ }
        }
        if (!fileSize) fileSize = photo.mediaType === 'video' ? 15 * 1024 * 1024 : 3 * 1024 * 1024;

        const binPhoto: BinPhoto = { ...photo, deletedAt: Date.now(), fileSize };
        setBinPhotos(prev => {
            // Prevent same ID from entering twice
            if (prev.find(p => p.id === photo.id)) return prev;
            return [binPhoto, ...prev];
        });
        setUndoStack(prev => [...prev, { photo, action: 'bin', fileSize }]);
        setCurrentIndex(prev => prev + 1);
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, deleted: s.deleted + 1, mbFreed: s.mbFreed + (fileSize / (1024 * 1024)) }));
    }, [currentIndex, photos]);

    const undo = useCallback(() => {
        if (undoStack.length === 0) return;
        const last = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        if (last.action === 'keep') {
            setKeptPhotos(prev => prev.filter(p => p.id !== last.photo.id));
            setSessionStats(s => ({ ...s, swiped: Math.max(0, s.swiped - 1), kept: Math.max(0, s.kept - 1) }));
        } else {
            setBinPhotos(prev => prev.filter(p => p.id !== last.photo.id));
            const mb = (last.fileSize || 0) / (1024 * 1024);
            setSessionStats(s => ({ ...s, swiped: Math.max(0, s.swiped - 1), deleted: Math.max(0, s.deleted - 1), mbFreed: Math.max(0, s.mbFreed - mb) }));
        }
        setCurrentIndex(prev => Math.max(0, prev - 1));
    }, [undoStack]);
    
    const deepReset = useCallback(async () => {
        // Clear all persistent storage
        await AsyncStorage.multiRemove([
            BIN_STORAGE_KEY,
            TOTAL_CLEARED_KEY,
            TOTAL_DELETED_KEY,
            '@bin_photos_v2', // old keys just in case
            '@total_cleared_bytes_v2',
            '@total_deleted_photos_v2'
        ]);
        
        // Reset all in-memory state
        setPhotos([]);
        setCurrentIndex(0);
        setKeptPhotos([]);
        setBinPhotos([]);
        setUndoStack([]);
        setBinStorageBytes(0);
        setTotalClearedBytes(0);
        setTotalDeletedPhotos(0);
        setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        setShowIntro(true);
        
        // Force reload stats from empty
        await loadCategoryStats();
    }, [loadCategoryStats]);

    return (
        <PhotoContext.Provider
            value={{
                photos, currentIndex, keptPhotos, binPhotos,
                currentPhoto, remainingCount, canUndo,
                permissionsGranted, isLoading, isLoadingSession,
                categoryCounts, binStorageBytes, sortMode, hasMore, sessionStats,
                setSortMode, swipeRight, swipeLeft, undo,
                commitDeletions, restoreFromBin,
                startSwipingSession, loadMore, endSession, loadCategoryStats,
                totalClearedBytes, totalDeletedPhotos,
                showIntro, setShowIntro, deepReset,
                userToken, isGuest, setUserToken,
            }}
        >
            {children}
        </PhotoContext.Provider>
    );
}

export function usePhotos() {
    const context = useContext(PhotoContext);
    if (!context) throw new Error('usePhotos must be used within a PhotoProvider');
    return context;
}
