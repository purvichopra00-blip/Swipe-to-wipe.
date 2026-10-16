/** Pure, testable photo-session helpers. No native image decoding or file downloads. */
export interface PeriodFilter {
    year: number;
    month?: number; // zero-based
    day?: number;
    mediaType?: 'photo' | 'video' | 'all';
}

export function periodBounds(filter: PeriodFilter): { createdAfter: number; createdBefore: number } {
    const { year, month, day } = filter;
    const start = new Date(year, month ?? 0, day ?? 1);
    const end = day !== undefined && month !== undefined
        ? new Date(year, month, day + 1)
        : month !== undefined ? new Date(year, month + 1, 1) : new Date(year + 1, 0, 1);
    return { createdAfter: start.getTime(), createdBefore: end.getTime() };
}

export function shuffled<T>(values: readonly T[], random = Math.random): T[] {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export interface AssetPage<T> {
    assets: T[];
    endCursor?: string;
    hasNextPage: boolean;
}
type PageReader<T> = (after?: string) => Promise<AssetPage<T>>;

/**
 * Random sessions shuffle page boundaries across the ENTIRE permitted library,
 * then shuffle within each page. Only cursors (not full-library photos/URIs) are
 * retained during the initial metadata scan. This is page-stratified randomness,
 * not an independent uniform draw of every asset.
 */
export class PhotoSessionPager<T extends { id: string }> {
    private cursor?: string;
    private randomPages: (string | undefined)[] = [];
    private cancelled = false;
    hasMore = true;

    constructor(private read: PageReader<T>, private random: boolean) {}

    cancel() { this.cancelled = true; this.hasMore = false; }

    async prepare(onScanned?: (count: number) => void): Promise<void> {
        if (!this.random) return;
        let after: string | undefined;
        const boundaries: (string | undefined)[] = [];
        let count = 0;
        do {
            const page = await this.read(after);
            if (this.cancelled) return;
            if (page.assets.length) boundaries.push(after);
            count += page.assets.length;
            onScanned?.(count);
            if (!page.hasNextPage || !page.endCursor || page.endCursor === after) break;
            after = page.endCursor;
        } while (!this.cancelled);
        this.randomPages = shuffled(boundaries);
        this.hasMore = this.randomPages.length > 0;
    }

    async next(ignored: () => ReadonlySet<string>): Promise<T[]> {
        // Reviewed-only pages must not masquerade as an empty library.
        while (this.hasMore && !this.cancelled) {
            const after = this.random ? this.randomPages[this.randomPages.length - 1] : this.cursor;
            const page = await this.read(after);
            if (this.cancelled) return [];
            if (this.random) {
                this.randomPages.pop();
                this.hasMore = this.randomPages.length > 0;
            } else {
                this.hasMore = page.hasNextPage && !!page.endCursor && page.endCursor !== after;
                this.cursor = page.endCursor;
            }
            const excluded = ignored();
            const seen = new Set<string>();
            const assets = page.assets.filter(asset => {
                if (excluded.has(asset.id) || seen.has(asset.id)) return false;
                seen.add(asset.id);
                return true;
            });
            if (assets.length) return this.random ? shuffled(assets) : assets;
        }
        return [];
    }
}

/** Serialize and coalesce saves; a slower old write can never overtake a new one. */
export class ReviewSaveQueue {
    private pending?: () => [string, string][];
    private timer?: ReturnType<typeof setTimeout>;
    private running: Promise<void> = Promise.resolve();
    constructor(
        private write: (pairs: [string, string][]) => Promise<void>,
        private onError: (error: unknown) => void,
        private delay = 250,
    ) {}
    schedule(snapshot: () => [string, string][]) {
        this.pending = snapshot;
        // Throttle, don't debounce indefinitely: continuous rapid swiping still
        // checkpoints progress every delay rather than waiting for a pause.
        if (!this.timer) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    }
    flush(): Promise<void> {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        const snapshot = this.pending;
        this.pending = undefined;
        if (snapshot) {
            const pairs = snapshot();
            this.running = this.running.then(() => this.write(pairs)).catch(this.onError);
        }
        return this.running;
    }
}