import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef, useMemo } from 'react';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'expo-image';
import { AppState, Platform, LogBox } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Photo } from '../constants/photos';
import { periodBounds, PhotoSessionPager, ReviewSaveQueue } from '../lib/photo-review';

// Suppress known non-critical library warnings from being visible to user
LogBox.ignoreLogs([
    'Encountered two children with the same key',
    'VirtualizedLists should never be nested',
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
    binPhotos: BinPhoto[];
    currentPhoto: Photo | null;
    remainingCount: number;
    canUndo: boolean;
    permissionsGranted: boolean;
    isLoading: boolean;
    isLoadingSession: boolean;
    scannedCount: number;
    sessionError: string | null;
    categoryCounts: CategoryCounts;
    binStorageBytes: number;
    sortMode: SortMode;
    hasMore: boolean;
    sessionStats: SessionStats;
    setSortMode: (mode: SortMode) => void;
    swipeRight: () => void;
    swipeLeft: () => void;
    undo: () => void;
    commitDeletions: (ids?: string[]) => Promise<boolean>;
    restoreFromBin: (id: string) => void;
    startSwipingSession: (category: string, filter?: DateFilter | null, sort?: SortMode) => Promise<void>;
    loadMore: () => Promise<void>;
    endSession: () => void;
    loadCategoryStats: () => Promise<void>;
    totalClearedBytes: number;
    totalDeletedPhotos: number;
    totalKeptPhotos: number;
    totalBinnedPhotos: number;
    streak: number;
    weeklySwipes: number;
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
const PRELOAD_AHEAD = 2;
const KEPT_IDS_KEY = '@kept_photo_ids_v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BIN_STORAGE_KEY = '@bin_photos_v2';
const TOTAL_CLEARED_KEY = '@total_cleared_bytes_v2';
const TOTAL_DELETED_KEY = '@total_deleted_photos_v2';
const TOTAL_KEPT_KEY = '@overall_kept_photos_v1';
const TOTAL_BINNED_KEY = '@overall_binned_photos_v1';
const STREAK_KEY = '@swipe_streak_v1';
const LAST_SWIPE_DATE_KEY = '@last_swipe_date_v1';
const WEEKLY_SWIPES_KEY = '@weekly_swipes_v1';

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
    // Persist lightweight IDs, not full photo objects. Older builds stored only a
    // count, so historic keep decisions cannot be reconstructed during migration.
    const keptIdsRef = useRef(new Set<string>());
    const [reviewRevision, setReviewRevision] = useState(0);
    const [isHydrated, setIsHydrated] = useState(false);
    const [scannedCount, setScannedCount] = useState(0);
    const [sessionError, setSessionError] = useState<string | null>(null);
    const pagerRef = useRef<PhotoSessionPager<MediaLibrary.Asset> | null>(null);
    const requestIdRef = useRef(0);
    const loadingMoreRef = useRef(false);
    const binRef = useRef<BinPhoto[]>([]);
    const lastSwipeDateRef = useRef<string | null>(null);
    const progressRef = useRef({ streak: 0, weekly: 0 });
    const expiredAttemptedRef = useRef(new Set<string>());
    const savedSnapshotRef = useRef<() => [string, string][]>(() => []);
    const saveQueueRef = useRef<ReviewSaveQueue | null>(null);
    if (!saveQueueRef.current) {
        saveQueueRef.current = new ReviewSaveQueue(
            pairs => AsyncStorage.multiSet(pairs),
            error => console.warn('Could not save review progress', error),
        );
    }
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
    const [streak, setStreak] = useState(0);
    const [weeklySwipes, setWeeklySwipes] = useState(0);
    const [showIntro, setShowIntro] = useState(true);
    const [userToken, setUserToken] = useState<string | null>(null);
    const isGuest = userToken === 'guest';

    const [screenshotAlbumId, setScreenshotAlbumId] = useState<string | null>(null);
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
            try {
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

            } catch (error) {
                console.warn('Could not load photo permissions', error);
                setIsLoading(false);
            }

            // Load persistent bin + stats
            try {
                const [storedBin, storedTotal, storedCount, storedKept, storedBinned, storedToken, storedCalTutorial, storedStreak, storedWeekly, storedKeptIds, storedLastSwipeDate] = await Promise.all([
                    AsyncStorage.getItem(BIN_STORAGE_KEY),
                    AsyncStorage.getItem(TOTAL_CLEARED_KEY),
                    AsyncStorage.getItem(TOTAL_DELETED_KEY),
                    AsyncStorage.getItem(TOTAL_KEPT_KEY),
                    AsyncStorage.getItem(TOTAL_BINNED_KEY),
                    AsyncStorage.getItem('@auth_token_v1'),
                    AsyncStorage.getItem('@calendar_tutorial_v1'),
                    AsyncStorage.getItem(STREAK_KEY),
                    AsyncStorage.getItem(WEEKLY_SWIPES_KEY),
                    AsyncStorage.getItem(KEPT_IDS_KEY),
                    AsyncStorage.getItem(LAST_SWIPE_DATE_KEY)
                ]);
                if (storedBin) {
                    try {
                        const parsed = JSON.parse(storedBin);
                        if (Array.isArray(parsed)) { binRef.current = parsed; setBinPhotos(parsed); }
                    } catch { }
                }
                if (storedKeptIds) {
                    const ids: unknown = JSON.parse(storedKeptIds);
                    if (Array.isArray(ids)) keptIdsRef.current = new Set(ids.filter((id): id is string => typeof id === 'string'));
                }
                if (storedTotal) setTotalClearedBytes(parseInt(storedTotal, 10) || 0);
                if (storedCount) setTotalDeletedPhotos(parseInt(storedCount, 10) || 0);
                if (storedKept) setTotalKeptPhotos(parseInt(storedKept, 10) || 0);
                if (storedBinned) setTotalBinnedPhotos(parseInt(storedBinned, 10) || 0);
                if (storedToken) setUserToken(storedToken);
                if (storedStreak) setStreak(parseInt(storedStreak, 10) || 0);
                if (storedWeekly) setWeeklySwipes(parseInt(storedWeekly, 10) || 0);
                lastSwipeDateRef.current = storedLastSwipeDate;
                progressRef.current = { streak: parseInt(storedStreak || '0', 10) || 0, weekly: parseInt(storedWeekly || '0', 10) || 0 };
                _setCalendarTutorialSeen(storedCalTutorial === 'true');
            } catch (err) {
                console.error('Persistence load error', err);
            } finally {
                setIsHydrated(true);
            }
        })();
    }, []);

    // Coalesce rapid swipes; serialize only at save time, including an empty bin.
    // Never overwrite storage with initial empty state before hydration completes.
    binRef.current = binPhotos;
    savedSnapshotRef.current = () => [
        [BIN_STORAGE_KEY, JSON.stringify(binRef.current)],
        [KEPT_IDS_KEY, JSON.stringify([...keptIdsRef.current])],
        [TOTAL_CLEARED_KEY, String(totalClearedBytes)],
        [TOTAL_DELETED_KEY, String(totalDeletedPhotos)],
        [TOTAL_KEPT_KEY, String(totalKeptPhotos)],
        [TOTAL_BINNED_KEY, String(totalBinnedPhotos)],
        [STREAK_KEY, String(progressRef.current.streak)],
        [WEEKLY_SWIPES_KEY, String(progressRef.current.weekly)],
        [LAST_SWIPE_DATE_KEY, lastSwipeDateRef.current || ''],
    ];
    useEffect(() => {
        if (isHydrated) saveQueueRef.current!.schedule(() => savedSnapshotRef.current());
    }, [isHydrated, binPhotos, reviewRevision]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            if (state !== 'active') void saveQueueRef.current!.flush();
        });
        return () => { sub.remove(); void saveQueueRef.current!.flush(); pagerRef.current?.cancel(); };
    }, []);

    useEffect(() => {
        if (isHydrated) saveQueueRef.current!.schedule(() => savedSnapshotRef.current());
    }, [isHydrated, totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos, streak, weeklySwipes]);

    // Sizes are estimates when the native size is unknown. Avoid a full bin
    // filesystem scan (and hundreds of native requests) after every swipe.
    useEffect(() => {
        setBinStorageBytes(binPhotos.reduce((sum, photo) => sum + (photo.fileSize || 0), 0));
    }, [binPhotos]);

    // Only the visible card stack decodes images. Disk-only prefetch excludes
    // videos; loading is guarded separately against concurrent page requests.
    useEffect(() => {
        for (let i = 1; i <= PRELOAD_AHEAD; i++) {
            const next = photos[currentIndex + i];
            if (next?.url && next.mediaType !== 'video') void Image.prefetch(next.url, 'disk').catch(() => {});
        }
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
        if (activeFilter?.year) Object.assign(base, periodBounds(activeFilter));
        if (category === 'Screenshots' && screenshotAlbumId) base.album = screenshotAlbumId;

        const mediaType = activeFilter?.mediaType === 'video' || category === 'Videos'
            ? [MediaLibrary.MediaType.video]
            : activeFilter?.mediaType === 'photo'
                ? [MediaLibrary.MediaType.photo]
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
            throw err;
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

    const ignoredIds = useCallback(() => new Set([
        ...keptIdsRef.current, ...binRef.current.map(photo => photo.id),
    ]), []);

    const startSwipingSession = useCallback(async (category: string, overrideFilter?: DateFilter | null, overrideSortMode?: SortMode) => {
        if (!isHydrated) return;
        const requestId = ++requestIdRef.current;
        pagerRef.current?.cancel();
        setIsLoadingSession(true);
        setSessionError(null);
        setScannedCount(0);
        setPhotos([]);
        setCurrentIndex(0);
        setUndoStack([]);
        setHasMore(false);
        activeCategoryRef.current = category;
        loadingMoreRef.current = false;
        // Freeze the options for this session so page 2 cannot switch date/sort.
        const filter = overrideFilter !== undefined ? overrideFilter : dateFilter;
        const sort = overrideSortMode || sortMode;
        const pager = new PhotoSessionPager<MediaLibrary.Asset>(
            after => fetchBatch(category, after, filter, sort),
            category === 'Random' && !filter,
        );
        pagerRef.current = pager;
        try {
            await pager.prepare(count => {
                if (requestId === requestIdRef.current) setScannedCount(count);
            });
            const assets = await pager.next(ignoredIds);
            if (requestId !== requestIdRef.current) return;
            setPhotos(mapAssets(assets));
            setHasMore(pager.hasMore);
            setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        } catch (error) {
            if (requestId === requestIdRef.current) {
                console.warn('Could not start photo session', error);
                setSessionError('Could not load your library. Please try again.');
            }
        } finally {
            if (requestId === requestIdRef.current) setIsLoadingSession(false);
        }
    }, [isHydrated, sortMode, dateFilter, fetchBatch, ignoredIds]);

    const loadMore = useCallback(async () => {
        const pager = pagerRef.current;
        if (!pager?.hasMore || loadingMoreRef.current || isLoadingSession) return;
        const requestId = requestIdRef.current;
        loadingMoreRef.current = true;
        setSessionError(null);
        try {
            const assets = await pager.next(ignoredIds);
            if (requestId !== requestIdRef.current) return;
            const excluded = ignoredIds();
            setPhotos(prev => {
                const existing = new Set(prev.map(photo => photo.id));
                return [...prev, ...mapAssets(assets.filter(asset => !existing.has(asset.id) && !excluded.has(asset.id)))];
            });
            setHasMore(pager.hasMore);
        } catch (error) {
            if (requestId === requestIdRef.current) {
                console.warn('Could not load more media', error);
                setSessionError('Could not load more media. Tap Retry.');
            }
        } finally {
            if (requestId === requestIdRef.current) loadingMoreRef.current = false;
        }
    }, [isLoadingSession, ignoredIds]);

    useEffect(() => {
        if (hasMore && photos.length - currentIndex <= 10 && !isLoadingSession && !sessionError) void loadMore();
    }, [hasMore, photos, currentIndex, isLoadingSession, sessionError, loadMore]);

    // Retain just the 50-item undo window, not every previously rendered asset.
    useEffect(() => {
        if (currentIndex < 100) return;
        const remove = currentIndex - 50;
        setPhotos(prev => prev.slice(remove));
        setCurrentIndex(indexRef.current - remove);
    }, [currentIndex]);

    const endSession = useCallback(() => {
        ++requestIdRef.current;
        pagerRef.current?.cancel();
        pagerRef.current = null;
        loadingMoreRef.current = false;
        setIsLoadingSession(false);
        setSessionError(null);
        setPhotos([]);
        setCurrentIndex(0);
        setUndoStack([]);
        setHasMore(false);
        void saveQueueRef.current!.flush();
    }, []);

    const commitDeletions = useCallback(async (ids?: string[]): Promise<boolean> => {
        const toDelete = ids ?? binPhotos.map(p => p.id);
        if (toDelete.length === 0) return false;

        const bytesToDelete = ids
            ? binPhotos.filter(p => ids.includes(p.id)).reduce((acc, p) => acc + (p.fileSize || 0), 0)
            : binStorageBytes;

        try {
            const success = await MediaLibrary.deleteAssetsAsync(toDelete);
            if (success) {
                setTotalClearedBytes(prev => prev + bytesToDelete);
                setTotalDeletedPhotos(prev => prev + toDelete.length);
                setBinPhotos(prev => ids ? prev.filter(p => !ids.includes(p.id)) : []);
                if (!ids) setBinStorageBytes(0);
                loadCategoryStats();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Batch deletion error', error);
            return false;
        }
    }, [binPhotos, binStorageBytes, loadCategoryStats]);

    // Preserve the existing seven-day policy, but do not drop local entries
    // before iOS confirms success. Cancellation is not retried on every render.
    useEffect(() => {
        if (!isHydrated || !permissionsGranted) return;
        const ids = binPhotos.filter(photo =>
            Date.now() - photo.deletedAt > SEVEN_DAYS_MS && !expiredAttemptedRef.current.has(photo.id)
        ).map(photo => photo.id);
        if (!ids.length) return;
        ids.forEach(id => expiredAttemptedRef.current.add(id));
        void commitDeletions(ids);
    }, [isHydrated, permissionsGranted, binPhotos, commitDeletions]);

    const restoreFromBin = useCallback((id: string) => {
        setBinPhotos(prev => prev.filter(p => p.id !== id));
    }, []);

    const currentPhoto = (currentIndex >= 0 && currentIndex < photos.length) ? photos[currentIndex] : null;
    const remainingCount = Math.max(0, photos.length - currentIndex);
    const canUndo = undoStack.length > 0;

    const trackSwipeProgress = useCallback(() => {
        const now = new Date();
        const today = now.toDateString();
        const previousDate = lastSwipeDateRef.current;
        let nextStreak = progressRef.current.streak;
        if (!previousDate) nextStreak = 1;
        else if (previousDate !== today) {
            const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
            nextStreak = previousDate === yesterday ? nextStreak + 1 : 1;
        }
        lastSwipeDateRef.current = today;
        progressRef.current = { streak: nextStreak, weekly: progressRef.current.weekly + 1 };
        setStreak(nextStreak);
        setWeeklySwipes(progressRef.current.weekly);
        // Saved with the rest of the snapshot, not six native storage calls per swipe.
    }, []);

    const swipeRight = useCallback(() => {
        const localIndex = indexRef.current;
        if (localIndex < 0 || localIndex >= photos.length) return;
        
        indexRef.current = localIndex + 1;
        _setCurrentIndex(localIndex + 1);

        const photo = photos[localIndex];
        keptIdsRef.current.add(photo.id);
        setReviewRevision(prev => prev + 1);
        setUndoStack(prev => [...prev, { photo, action: 'keep' as const }].slice(-50));
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, kept: s.kept + 1 }));
        setTotalKeptPhotos(prev => prev + 1);
        trackSwipeProgress();
    }, [photos, trackSwipeProgress]);

    const swipeLeft = useCallback(() => {
        const localIndex = indexRef.current;
        if (localIndex < 0 || localIndex >= photos.length) return;
        
        indexRef.current = localIndex + 1;
        _setCurrentIndex(localIndex + 1);

        const photo = photos[localIndex];
        const initialFileSize = photo.fileSize || (photo.mediaType === 'video' ? 15 * 1024 * 1024 : 3 * 1024 * 1024);

        // Synchronously update UI state to avoid any delay
        setUndoStack(prev => [...prev, { photo, action: 'bin' as const, fileSize: initialFileSize }].slice(-50));
        setSessionStats(s => ({ ...s, swiped: s.swiped + 1, deleted: s.deleted + 1, mbFreed: s.mbFreed + (initialFileSize / (1024 * 1024)) }));
        setTotalBinnedPhotos(prev => prev + 1);
        trackSwipeProgress();

        // Queue the bin item synchronously so Undo cannot race an async native
        // file lookup and unexpectedly re-add a photo after it was restored.
        const binPhoto: BinPhoto = { ...photo, deletedAt: Date.now(), fileSize: initialFileSize };
        setBinPhotos(prev => prev.some(item => item.id === photo.id) ? prev : [binPhoto, ...prev]);
    }, [photos, trackSwipeProgress]);

    const undo = useCallback(() => {
        if (undoStack.length === 0) return;
        const last = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, -1));
        if (last.action === 'keep') {
            keptIdsRef.current.delete(last.photo.id);
            setReviewRevision(prev => prev + 1);
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
        endSession();
        await saveQueueRef.current!.flush();
        // Clear all persistent storage
        await AsyncStorage.multiRemove([
            BIN_STORAGE_KEY,
            KEPT_IDS_KEY,
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
            '@calendar_tutorial_v1',
            STREAK_KEY,
            LAST_SWIPE_DATE_KEY,
            WEEKLY_SWIPES_KEY
        ]);
        
        // Reset all in-memory state
        setPhotos([]);
        setCurrentIndex(0);
        keptIdsRef.current.clear();
        lastSwipeDateRef.current = null;
        progressRef.current = { streak: 0, weekly: 0 };
        expiredAttemptedRef.current.clear();
        setReviewRevision(prev => prev + 1);
        setBinPhotos([]);
        setUndoStack([]);
        setBinStorageBytes(0);
        setTotalClearedBytes(0);
        setTotalDeletedPhotos(0);
        setTotalKeptPhotos(0);
        setTotalBinnedPhotos(0);
        setStreak(0);
        setWeeklySwipes(0);
        setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        setShowIntro(true);
        setUserToken(null);
        setPermissionsGranted(false);
        
        // Force reload stats from empty
        await loadCategoryStats();
    }, [loadCategoryStats, endSession]);

    const contextValue = useMemo(() => ({
        photos, currentIndex, binPhotos,
        currentPhoto, remainingCount, canUndo,
        permissionsGranted, isLoading: isLoading || !isHydrated, isLoadingSession: isLoadingSession || !isHydrated,
        scannedCount, sessionError,
        categoryCounts, binStorageBytes, sortMode, hasMore, sessionStats,
        setSortMode, swipeRight, swipeLeft, undo,
        commitDeletions, restoreFromBin,
        startSwipingSession, loadMore, endSession, loadCategoryStats,
        totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        streak, weeklySwipes,
        showIntro, setShowIntro, deepReset,
        userToken, isGuest, setUserToken,
        dateFilter, setDateFilter,
        showCalendar, setShowCalendar,
        calendarTutorialSeen, setCalendarTutorialSeen
    }), [
        photos, currentIndex, binPhotos,
        currentPhoto, remainingCount, canUndo,
        permissionsGranted, isLoading, isHydrated, isLoadingSession, scannedCount, sessionError,
        categoryCounts, binStorageBytes, sortMode, hasMore, sessionStats,
        setSortMode, swipeRight, swipeLeft, undo,
        commitDeletions, restoreFromBin,
        startSwipingSession, loadMore, endSession, loadCategoryStats,
        totalClearedBytes, totalDeletedPhotos, totalKeptPhotos, totalBinnedPhotos,
        streak, weeklySwipes,
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
