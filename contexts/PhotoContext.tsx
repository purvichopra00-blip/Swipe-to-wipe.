import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef, useMemo } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { Platform, LogBox } from 'react-native';
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

export interface DateFilter {
    year: number;
    month?: number;
    day?: number;
    mediaType?: 'photo' | 'video' | 'all';
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
    startSwipingSession: (category: string, filter?: DateFilter | null) => Promise<void>;
    loadMore: () => Promise<void>;
    endSession: () => void;
    loadCategoryStats: () => Promise<void>;
    totalClearedBytes: number;
    totalDeletedPhotos: number;
    totalKeptPhotos: number;
    totalBinnedPhotos: number;
    showIntro: boolean;
    setShowIntro: (show: boolean) => void;
    deepReset: () => Promise<void>;
    userToken: string | null;
    isGuest: boolean;
    setUserToken: (token: string | null) => void;
    dateFilter: DateFilter | null;
    setDateFilter: (filter: DateFilter | null) => void;
    showCalendar: boolean;
    setShowCalendar: (show: boolean) => void;
    calendarTutorialSeen: boolean;
    setCalendarTutorialSeen: (seen: boolean) => void;
}

const PhotoContext = createContext<PhotoContextType | undefined>(undefined);

const BATCH_SIZE = 200;
const PRELOAD_AHEAD = 4;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BIN_STORAGE_KEY = '@bin_photos_v2';
const TOTAL_CLEARED_KEY = '@total_cleared_bytes_v2';
const TOTAL_DELETED_KEY = '@total_deleted_photos_v2';
const TOTAL_KEPT_KEY = '@overall_kept_photos_v1';
const TOTAL_BINNED_KEY = '@overall_binned_photos_v1';

export function PhotoProvider({ children }: { children: ReactNode }) {
    const [permissionsGranted, setPermissionsGranted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingSession, setIsLoadingSession] = useState(false);
    const [categoryCounts, setCategoryCounts] = useState<CategoryCounts>({
        total: 0, photos: 0, videos: 0, screenshots: 0, recents: 0
    });

    const [photos, setPhotos] = useState<Photo[]>([]);
    const [currentIndex, _setCurrentIndex] = useState(0);
    const indexRef = useRef(0);
    const setCurrentIndex = useCallback((val: number | ((prev: number) => number)) => {
        if (typeof val === 'function') {
            _setCurrentIndex(prev => {
                const next = val(prev);
                indexRef.current = next;
                return next;
            });
        } else {
            indexRef.current = val;
            _setCurrentIndex(val);
        }
    }, []);
    const [keptPhotos, setKeptPhotos] = useState<Photo[]>([]);
    const [binPhotos, setBinPhotos] = useState<BinPhoto[]>([]);
    const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
    const [binStorageBytes, setBinStorageBytes] = useState(0);
    const [sortMode, setSortMode] = useState<SortMode>('newest');
    const [hasMore, setHasMore] = useState(false);
    const [sessionStats, setSessionStats] = useState<SessionStats>({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
    const [totalClearedBytes, setTotalClearedBytes] = useState(0);
    const [totalDeletedPhotos, setTotalDeletedPhotos] = useState(0);
    const [totalKeptPhotos, setTotalKeptPhotos] = useState(0);
    const [totalBinnedPhotos, setTotalBinnedPhotos] = useState(0);
    const [showIntro, setShowIntro] = useState(true);
    const [userToken, setUserToken] = useState<string | null>(null);
    const isGuest = userToken === 'guest';

    const [screenshotAlbumId, setScreenshotAlbumId] = useState<string | null>(null);
    const cursorRef = useRef<string | undefined>(undefined);
    const activeCategoryRef = useRef<string>('Random');
    const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);
    const [calendarTutorialSeen, _setCalendarTutorialSeen] = useState(false); // Default to false so it shows up

    const setCalendarTutorialSeen = useCallback((val: boolean) => {
        _setCalendarTutorialSeen(val);
        AsyncStorage.setItem('@calendar_tutorial_v1', val ? 'true' : 'false').catch(() => {});
    }, []);

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
                const [storedBin, storedTotal, storedCount, storedKept, storedBinned, storedToken, storedCalTutorial] = await Promise.all([
                    AsyncStorage.getItem(BIN_STORAGE_KEY),
                    AsyncStorage.getItem(TOTAL_CLEARED_KEY),
                    AsyncStorage.getItem(TOTAL_DELETED_KEY),
                    AsyncStorage.getItem(TOTAL_KEPT_KEY),
                    AsyncStorage.getItem(TOTAL_BINNED_KEY),
                    AsyncStorage.getItem('@auth_token_v1'),
                    AsyncStorage.getItem('@calendar_tutorial_v1')
                ]);
                if (storedBin) {
                    try {
                        const parsed = JSON.parse(storedBin);
                        if (Array.isArray(parsed)) setBinPhotos(parsed);
                    } catch { }
                }
                if (storedTotal) setTotalClearedBytes(parseInt(storedTotal, 10) || 0);
                if (storedCount) setTotalDeletedPhotos(parseInt(storedCount, 10) || 0);
                if (storedKept) setTotalKeptPhotos(parseInt(storedKept, 10) || 0);
                if (storedBinned) setTotalBinnedPhotos(parseInt(storedBinned, 10) || 0);
                if (storedToken) setUserToken(storedToken);
                _setCalendarTutorialSeen(storedCalTutorial === 'true');
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
        if (totalDeletedPhotos > 0) AsyncStorage.setItem(TOTAL_DELETED_KEY, totalDeletedPhotos.toString()).catch(() => { });
    }, [totalDeletedPhotos]);

    useEffect(() => {
        if (totalKeptPhotos > 0) AsyncStorage.setItem(TOTAL_KEPT_KEY, totalKeptPhotos.toString()).catch(() => { });
    }, [totalKeptPhotos]);

    useEffect(() => {
        if (totalBinnedPhotos > 0) AsyncStorage.setItem(TOTAL_BINNED_KEY, totalBinnedPhotos.toString()).catch(() => { });
    }, [totalBinnedPhotos]);

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

    const mapAssets = (assets: MediaLibrary.Asset[]): Photo[] => {
        return assets.map(asset => ({
            id: asset.id, url: asset.uri, mediaType: asset.mediaType,
            duration: asset.duration, creationTime: asset.creationTime,
            modificationTime: asset.modificationTime, filename: asset.filename, fileSize: 0,
        }));
    };

    const fetchBatch = useCallback(async (category: string, after?: string, currentFilter?: DateFilter | null, currentSort?: SortMode) => {
        const activeSort = currentSort || sortMode;
        const sortBy = getSortBy(activeSort);
        const base: any = { first: BATCH_SIZE, sortBy, after };

        const activeFilter = currentFilter !== undefined ? currentFilter : dateFilter;
        if (activeFilter?.year) {
            let start: Date, end: Date;
            
            if (activeFilter.day !== undefined && activeFilter.month !== undefined) {
                start = new Date(activeFilter.year, activeFilter.month, activeFilter.day);
                end = new Date(activeFilter.year, activeFilter.month, activeFilter.day + 1);
            } else if (activeFilter.month !== undefined) {
                start = new Date(activeFilter.year, activeFilter.month, 1);
                end = new Date(activeFilter.year, activeFilter.month + 1, 1);
            } else {
                start = new Date(activeFilter.year, 0, 1);
                end = new Date(activeFilter.year + 1, 0, 1);
            }
            
            base.createdAfter = start;
            base.createdBefore = end;
            
            if (__DEV__) {
                const label = activeFilter.day !== undefined 
                    ? `${activeFilter.year}-${activeFilter.month! + 1}-${activeFilter.day}`
                    : activeFilter.month !== undefined 
                        ? `${activeFilter.year}-${activeFilter.month + 1}`
                        : `${activeFilter.year}`;
                console.log(`[PhotoContext] Fetching ${category} for ${label} (Sort: ${activeSort})`, {
                    start: start.toLocaleString(),
                    end: end.toLocaleString()
                });
            }
        }

        const mediaType = activeFilter?.mediaType === 'video' || category === 'Videos'
            ? [MediaLibrary.MediaType.video]
            : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];

        try {
            const result = await MediaLibrary.getAssetsAsync({ ...base, mediaType });

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
    }, [sortMode, dateFilter, screenshotAlbumId]);

    const loadCategoryStats = useCallback(async () => {
        setIsLoading(true);
        try {
            const [photosResp, videosResp, albums] = await Promise.all([
                MediaLibrary.getAssetsAsync({ mediaType: [MediaLibrary.MediaType.photo], first: 1 }),
                MediaLibrary.getAssetsAsync({ mediaType: [MediaLibrary.MediaType.video], first: 1 }),
                MediaLibrary.getAlbumsAsync()
            ]);
            const screenshotsAlbum = albums.find(a => {
                const t = a.title.toLowerCase();
                return t.includes('screenshot') || t.includes('capture') || t.includes('screens') || t.includes('screencap') || t.includes('scr_');
            });
            let screenshotCount = 0;
            if (screenshotsAlbum) {
                setScreenshotAlbumId(screenshotsAlbum.id);
                const screenResp = await MediaLibrary.getAssetsAsync({ album: screenshotsAlbum.id, first: 1 });
                screenshotCount = screenResp.totalCount || 0;
            }

            setCategoryCounts({
                total: (photosResp.totalCount || 0) + (videosResp.totalCount || 0),
                photos: photosResp.totalCount || 0,
                videos: videosResp.totalCount || 0,
                screenshots: screenshotCount,
                recents: Math.min((photosResp.totalCount || 0) + (videosResp.totalCount || 0), 100),
            });
        } catch (error) {
            console.error('Error loading stats:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const startSwipingSession = useCallback(async (category: string, overrideFilter?: DateFilter | null, overrideSortMode?: SortMode) => {
        setIsLoadingSession(true);
        setPhotos([]); // Clear immediately for visual feedback
        setCurrentIndex(0);
        setUndoStack([]);
        cursorRef.current = undefined;
        activeCategoryRef.current = category;

        const activeFilter = overrideFilter !== undefined ? overrideFilter : dateFilter;
        const activeSort = overrideSortMode || sortMode;
        
        const { assets, endCursor, hasNextPage } = await fetchBatch(category, undefined, activeFilter, activeSort);

        // Robust filtering against existing bin/kept IDs
        const ignoredIds = new Set([...keptPhotos.map(p => p.id), ...binPhotos.map(p => p.id)]);
        const filtered = assets.filter(a => !ignoredIds.has(a.id));

        if (category === 'Random') filtered.sort(() => 0.5 - Math.random());

        const mapped = mapAssets(filtered);
        setPhotos(mapped);
        cursorRef.current = endCursor;
        setHasMore(hasNextPage);
        setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        setIsLoadingSession(false);
    }, [keptPhotos, binPhotos, sortMode, screenshotAlbumId, dateFilter, fetchBatch]);

    const loadMore = useCallback(async () => {
        if (!hasMore || !cursorRef.current || isLoadingSession) return;
        const { assets, endCursor, hasNextPage } = await fetchBatch(activeCategoryRef.current, cursorRef.current);

        const currentIds = new Set(photos.map(p => p.id));
        const ignoredIds = new Set([...keptPhotos.map(p => p.id), ...binPhotos.map(p => p.id)]);

        const filtered = assets.filter(a => !currentIds.has(a.id) && !ignoredIds.has(a.id));
        const mapped = mapAssets(filtered);

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
        const localIndex = indexRef.current;
        if (localIndex < 0 || localIndex >= photos.length) return;
        
        indexRef.current = localIndex + 1;
        _setCurrentIndex(localIndex + 1);

        const photo = photos[localIndex];
        setKeptPhotos(prev => [photo, ...prev]);
        setUndoStack(prev => [...prev, { photo, action: 'keep' }]);
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, kept: s.kept + 1 }));
        setTotalKeptPhotos(prev => prev + 1);
    }, [photos]);

    const swipeLeft = useCallback(() => {
        const localIndex = indexRef.current;
        if (localIndex < 0 || localIndex >= photos.length) return;
        
        indexRef.current = localIndex + 1;
        _setCurrentIndex(localIndex + 1);

        const photo = photos[localIndex];
        const initialFileSize = photo.fileSize || (photo.mediaType === 'video' ? 15 * 1024 * 1024 : 3 * 1024 * 1024);

        // Synchronously update UI state to avoid any delay
        setUndoStack(prev => [...prev, { photo, action: 'bin', fileSize: initialFileSize }]);
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, deleted: s.deleted + 1, mbFreed: s.mbFreed + (initialFileSize / (1024 * 1024)) }));
        setTotalBinnedPhotos(prev => prev + 1);

        // Process heavy filesystem fetching in the background asynchronously
        // Optimized: Only fetch if we don't already have the size
        if (!photo.fileSize) {
            (async () => {
                let actualFileSize = 0;
                try {
                    const info = await MediaLibrary.getAssetInfoAsync(photo.id, { shouldDownloadFromNetwork: false });
                    const localUri = info.localUri || info.uri;
                    if (localUri) {
                        const fi = await FileSystem.getInfoAsync(localUri);
                        if (fi.exists && !fi.isDirectory) actualFileSize = (fi as any).size ?? 0;
                    }
                } catch { /* ignore */ }
                
                const finalSize = actualFileSize || initialFileSize;
                const binPhoto: BinPhoto = { ...photo, deletedAt: Date.now(), fileSize: finalSize };
                setBinPhotos(prev => {
                    if (prev.find(p => p.id === photo.id)) return prev;
                    return [binPhoto, ...prev];
                });
            })();
        } else {
            const binPhoto: BinPhoto = { ...photo, deletedAt: Date.now() };
            setBinPhotos(prev => {
                if (prev.find(p => p.id === photo.id)) return prev;
                return [binPhoto, ...prev];
            });
        }
    }, [photos]);

    const undo = useCallback(() => {
        if (undoStack.length === 0) return;
        const last = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        if (last.action === 'keep') {
            setKeptPhotos(prev => prev.filter(p => p.id !== last.photo.id));
            setSessionStats(s => ({ ...s, swiped: Math.max(0, s.swiped - 1), kept: Math.max(0, s.kept - 1) }));
            setTotalKeptPhotos(prev => Math.max(0, prev - 1));
        } else {
            setBinPhotos(prev => prev.filter(p => p.id !== last.photo.id));
            const mb = (last.fileSize || 0) / (1024 * 1024);
            setSessionStats(s => ({ ...s, swiped: Math.max(0, s.swiped - 1), deleted: Math.max(0, s.deleted - 1), mbFreed: Math.max(0, s.mbFreed - mb) }));
            setTotalBinnedPhotos(prev => Math.max(0, prev - 1));
        }
        setCurrentIndex(prev => Math.max(0, prev - 1));
    }, [undoStack]);
    
    const deepReset = useCallback(async () => {
        // Clear all persistent storage
        await AsyncStorage.multiRemove([
            BIN_STORAGE_KEY,
            TOTAL_CLEARED_KEY,
            TOTAL_DELETED_KEY,
            TOTAL_KEPT_KEY,
            TOTAL_BINNED_KEY,
            '@onboarding_completed_v4',
            '@permissions_granted_v1',
            '@auth_token_v1',
            '@bin_photos_v2',
            '@total_cleared_bytes_v2',
            '@total_deleted_photos_v2',
            '@calendar_tutorial_v1'
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
        setTotalKeptPhotos(0);
        setTotalBinnedPhotos(0);
        setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        setShowIntro(true);
        setUserToken(null);
        setPermissionsGranted(false);
        
        // Force reload stats from empty
        await loadCategoryStats();
    }, [loadCategoryStats]);

    const contextValue = useMemo(() => ({
        photos, currentIndex, keptPhotos, binPhotos,
        currentPhoto, remainingCount, canUndo,
        permissionsGranted, isLoading, isLoadingSession,
        categoryCounts, binStorageBytes, sortMode, hasMore, sessionStats,
        setSortMode, swipeRight, swipeLeft, undo,
        commitDeletions, restoreFromBin,
        startSwipingSession, loadMore, endSession, loadCategoryStats,
        totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        showIntro, setShowIntro, deepReset,
        userToken, isGuest, setUserToken,
        dateFilter, setDateFilter,
        showCalendar, setShowCalendar,
        calendarTutorialSeen, setCalendarTutorialSeen
    }), [
        photos, currentIndex, keptPhotos, binPhotos,
        currentPhoto, remainingCount, canUndo,
        permissionsGranted, isLoading, isLoadingSession,
        categoryCounts, binStorageBytes, sortMode, hasMore, sessionStats,
        setSortMode, swipeRight, swipeLeft, undo,
        commitDeletions, restoreFromBin,
        startSwipingSession, loadMore, endSession, loadCategoryStats,
        totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        showIntro, setShowIntro, userToken, isGuest, dateFilter,
        showCalendar, setShowCalendar, calendarTutorialSeen, setCalendarTutorialSeen
    ]);

    return (
        <PhotoContext.Provider value={contextValue}>
            {children}
        </PhotoContext.Provider>
    );
}


export function usePhotos() {
    const context = useContext(PhotoContext);
    if (!context) throw new Error('usePhotos must be used within a PhotoProvider');
    return context;
}
