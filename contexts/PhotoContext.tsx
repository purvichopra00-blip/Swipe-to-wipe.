import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { ActionSheetIOS, Platform, LogBox, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { 
    AUTH_TOKEN_KEY, 
    AUTH_ID_TOKEN,
    ONBOARDING_COMPLETED_KEY,
    PERMISSIONS_GRANTED_KEY 
} from '../lib/firebase';
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
    keptCount: number;
    binCount: number;
    isLoading: boolean;
    isLoadingSession: boolean;
    categoryCounts: CategoryCounts;
    sessionStats: SessionStats;
    totalClearedBytes: number;
    totalDeletedPhotos: number;
    binStorageBytes: number;
    hasMore: boolean;
    isGuest: boolean;
    showIntro: boolean;
    setShowIntro: (s: boolean) => void;
    setUserToken: (t: string | null) => void;
    handleSwipe: (action: 'keep' | 'bin') => Promise<void>;
    undoLast: () => void;
    commitDeletions: (ids?: string[]) => Promise<void>;
    restoreFromBin: (id: string) => Promise<void>;
    loadCategoryStats: (category?: string) => Promise<void>;
    loadMore: () => Promise<void>;
    deepReset: () => Promise<void>;
    endSession: () => void;
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

    // Initial load: Persistent State
    useEffect(() => {
        (async () => {
            // Load persistent bin + stats
            try {
                const [storedBin, storedTotal, storedCount, storedToken] = await Promise.all([
                    AsyncStorage.getItem(BIN_STORAGE_KEY),
                    AsyncStorage.getItem(TOTAL_CLEARED_KEY),
                    AsyncStorage.getItem(TOTAL_DELETED_KEY),
                    AsyncStorage.getItem(AUTH_TOKEN_KEY)
                ]);
                if (storedBin) setBinPhotos(JSON.parse(storedBin));
                if (storedTotal) setTotalClearedBytes(parseInt(storedTotal, 10));
                if (storedCount) setTotalDeletedPhotos(parseInt(storedCount, 10));
                if (storedToken) setUserToken(storedToken);
            } catch (err) {
                console.error('Persistence load error', err);
            } finally {
                // Now check permissions
                const { status, accessPrivileges } = await MediaLibrary.getPermissionsAsync();
                if (status === 'granted' || (Platform.OS === 'ios' && (accessPrivileges === 'all' || accessPrivileges === 'limited'))) {
                    setPermissionsGranted(true);
                    loadCategoryStats();
                } else {
                    setPermissionsGranted(false);
                    setIsLoading(false);
                }
            }
        })();
    }, []);

    // Individual Persistence
    useEffect(() => {
        AsyncStorage.setItem(BIN_STORAGE_KEY, JSON.stringify(binPhotos)).catch(() => { });
    }, [binPhotos]);

    useEffect(() => {
        AsyncStorage.setItem(TOTAL_CLEARED_KEY, totalClearedBytes.toString()).catch(() => { });
    }, [totalClearedBytes]);

    useEffect(() => {
        AsyncStorage.setItem(TOTAL_DELETED_KEY, totalDeletedPhotos.toString()).catch(() => { });
    }, [totalDeletedPhotos]);

    // Recalculate Bin Storage size
    useEffect(() => {
        let isMounted = true;
        const calculateBinSize = async () => {
            if (binPhotos.length === 0) {
                if (isMounted) setBinStorageBytes(0);
                return;
            }
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
            setBinPhotos(prev => prev.filter(p => now - p.deletedAt <= SEVEN_DAYS_MS));
        }

        return () => { isMounted = false; };
    }, [binPhotos]);

    const loadCategoryStats = async (category: string = 'Random') => {
        setIsLoading(true);
        activeCategoryRef.current = category;
        try {
            const alb = await MediaLibrary.getAlbumsAsync();
            const screenshotAlb = alb.find(a => a.title.toLowerCase().includes('screenshot'));
            setScreenshotAlbumId(screenshotAlb?.id || null);

            const total = await MediaLibrary.getAssetsAsync({ mediaType: ['photo', 'video'] });
            const photos = await MediaLibrary.getAssetsAsync({ mediaType: 'photo' });
            const videos = await MediaLibrary.getAssetsAsync({ mediaType: 'video' });
            const screenshots = screenshotAlb ? await MediaLibrary.getAssetsAsync({ album: screenshotAlb.id, mediaType: 'photo' }) : { totalCount: 0 };
            const recents = await MediaLibrary.getAssetsAsync({ mediaType: ['photo', 'video'], first: 100, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });

            setCategoryCounts({
                total: total.totalCount,
                photos: photos.totalCount,
                videos: videos.totalCount,
                screenshots: screenshots.totalCount,
                recents: recents.totalCount
            });

            await startSession(category, screenshotAlb?.id);
        } catch (err) {
            console.error('Category stats error', err);
        } finally {
            setIsLoading(false);
        }
    };

    const startSession = async (category: string, screenshotAlbId?: string | null) => {
        setIsLoadingSession(true);
        setCurrentIndex(0);
        setUndoStack([]);
        cursorRef.current = undefined;
        
        const fetchOptions: MediaLibrary.AssetsOptions = {
            first: 50,
            mediaType: ['photo', 'video'],
            sortBy: [[MediaLibrary.SortBy.creationTime, sortMode === 'oldest']],
        };

        if (category === 'Screenshots' && (screenshotAlbId || screenshotAlbumId)) {
            fetchOptions.album = screenshotAlbId || screenshotAlbumId || undefined;
        } else if (category === 'Videos') {
            fetchOptions.mediaType = ['video'];
        } else if (category === 'Photos') {
            fetchOptions.mediaType = ['photo'];
        }

        try {
            const result = await MediaLibrary.getAssetsAsync(fetchOptions);
            const filtered = result.assets.filter(a => !binPhotos.some(bp => bp.id === a.id));
            
            setPhotos(filtered.map(a => ({
                id: a.id,
                url: a.uri,
                mediaType: a.mediaType as any,
                duration: a.duration,
                creationTime: a.creationTime,
                modificationTime: a.modificationTime,
                filename: a.filename,
                fileSize: (a as any).width * (a as any).height * 0.5 // Rough fallback estimate
            })));
            
            cursorRef.current = result.endCursor;
            setHasMore(result.hasNextPage);
            setSessionStats({ swiped: 0, kept: 0, deleted: 0, mbFreed: 0 });
        } catch (err) {
            console.error('Session start error', err);
        } finally {
            setIsLoadingSession(false);
        }
    };

    const loadMore = async () => {
        if (!hasMore || !cursorRef.current || isLoadingSession) return;
        setIsLoadingSession(true);
        const options: MediaLibrary.AssetsOptions = {
            after: cursorRef.current,
            first: 50,
            mediaType: activeCategoryRef.current === 'Videos' ? ['video'] : (activeCategoryRef.current === 'Photos' ? ['photo'] : ['photo', 'video']),
            sortBy: [[MediaLibrary.SortBy.creationTime, sortMode === 'oldest']],
        };

        if (activeCategoryRef.current === 'Screenshots' && screenshotAlbumId) {
            options.album = screenshotAlbumId;
        }

        try {
            const result = await MediaLibrary.getAssetsAsync(options);
            const filtered = result.assets.filter(a => !binPhotos.some(p => p.id === a.id));
            
            const newPhotos = filtered.map(a => ({
                id: a.id,
                url: a.uri,
                mediaType: a.mediaType as any,
                duration: a.duration,
                creationTime: a.creationTime,
                modificationTime: a.modificationTime,
                filename: a.filename,
                fileSize: (a as any).width * (a as any).height * 0.5
            }));
            
            setPhotos(prev => [...prev, ...newPhotos]);
            cursorRef.current = result.endCursor;
            setHasMore(result.hasNextPage);
        } catch (err) {
            console.error('Load more error', err);
        } finally {
            setIsLoadingSession(false);
        }
    };

    const handleSwipe = async (action: 'keep' | 'bin') => {
        const photo = photos[currentIndex];
        if (!photo) return;

        setUndoStack(prev => [{ photo, action, fileSize: photo.fileSize }, ...prev].slice(0, 10));
        
        if (action === 'keep') {
            setKeptPhotos(prev => [...prev, photo]);
            setSessionStats(s => ({ ...s, swiped: s.swiped + 1, kept: s.kept + 1 }));
        } else {
            setBinPhotos(prev => [{ ...photo, deletedAt: Date.now() }, ...prev]);
            setSessionStats(s => ({ ...s, swiped: s.swiped + 1, deleted: s.deleted + 1, mbFreed: s.mbFreed + ((photo.fileSize || 0) / 1024 / 1024) }));
        }

        setCurrentIndex(prev => prev + 1);

        // Preload next
        if (photos[currentIndex + PRELOAD_AHEAD]) {
            Image.prefetch(photos[currentIndex + PRELOAD_AHEAD].url);
        }

        // Auto load more if near end
        if (currentIndex > photos.length - 10 && hasMore) {
            loadMore();
        }
    };

    const undoLast = () => {
        if (undoStack.length === 0) return;
        const entry = undoStack[0];
        setUndoStack(prev => prev.slice(1));
        
        if (entry.action === 'keep') {
            setKeptPhotos(prev => prev.filter(p => p.id !== entry.photo.id));
            setSessionStats(s => ({ ...s, swiped: s.swiped - 1, kept: s.kept - 1 }));
        } else {
            setBinPhotos(prev => prev.filter(p => p.id !== entry.photo.id));
            setSessionStats(s => ({ ...s, swiped: s.swiped - 1, deleted: s.deleted - 1, mbFreed: s.mbFreed - ((entry.fileSize || 0) / 1024 / 1024) }));
        }
        
        setCurrentIndex(prev => prev - 1);
    };

    const commitDeletions = async (ids?: string[]) => {
        const toDelete = ids ? binPhotos.filter(p => ids.includes(p.id)) : binPhotos;
        if (toDelete.length === 0) return;

        try {
            const success = await MediaLibrary.deleteAssetsAsync(toDelete.map(p => p.id));
            if (success) {
                const deletedBytes = toDelete.reduce((acc, p) => acc + (p.fileSize || 0), 0);
                setTotalClearedBytes(prev => prev + deletedBytes);
                setTotalDeletedPhotos(prev => prev + toDelete.length);
                setBinPhotos(prev => prev.filter(p => !toDelete.some(td => td.id === p.id)));
                loadCategoryStats();
            }
        } catch (err) {
            console.error('Commit deletions error', err);
            Alert.alert('Error', 'Could not delete assets. Please check permissions.');
        }
    };

    const restoreFromBin = async (id: string) => {
        setBinPhotos(prev => prev.filter(p => p.id !== id));
    };

    const endSession = () => {
        setPhotos([]);
        setCurrentIndex(0);
        setUndoStack([]);
        cursorRef.current = undefined;
        setHasMore(false);
    };

    const deepReset = async () => {
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
        // Clear all production keys
        await AsyncStorage.multiRemove([
            BIN_STORAGE_KEY, 
            TOTAL_CLEARED_KEY, 
            TOTAL_DELETED_KEY, 
            AUTH_TOKEN_KEY, 
            AUTH_ID_TOKEN,
            ONBOARDING_COMPLETED_KEY,
            PERMISSIONS_GRANTED_KEY
        ]);
    };

    const value = {
        photos, currentIndex, keptPhotos, binPhotos, currentPhoto: photos[currentIndex] || null,
        remainingCount: photos.length - currentIndex,
        keptCount: keptPhotos.length,
        binCount: binPhotos.length,
        isLoading, isLoadingSession, categoryCounts, sessionStats,
        totalClearedBytes, totalDeletedPhotos, binStorageBytes, hasMore, isGuest,
        showIntro, setShowIntro, setUserToken, handleSwipe, undoLast, commitDeletions,
        restoreFromBin, loadCategoryStats, loadMore, deepReset, endSession
    };

    return (
        <PhotoContext.Provider value={value}>
            {children}
        </PhotoContext.Provider>
    );
}

export const usePhotos = () => {
    const context = useContext(PhotoContext);
    if (!context) throw new Error('usePhotos must be used within PhotoProvider');
    return context;
};
