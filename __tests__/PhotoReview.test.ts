import { periodBounds, shuffled, PhotoSessionPager, ReviewSaveQueue } from '../lib/photo-review';

describe('review periods', () => {
    test('whole year, leap month and day use next-period local boundaries', () => {
        expect(periodBounds({ year: 2024 })).toEqual({
            createdAfter: new Date(2024, 0, 1).getTime(), createdBefore: new Date(2025, 0, 1).getTime(),
        });
        expect(periodBounds({ year: 2024, month: 1 })).toEqual({
            createdAfter: new Date(2024, 1, 1).getTime(), createdBefore: new Date(2024, 2, 1).getTime(),
        });
        expect(periodBounds({ year: 2024, month: 1, day: 29 })).toEqual({
            createdAfter: new Date(2024, 1, 29).getTime(), createdBefore: new Date(2024, 2, 1).getTime(),
        });
    });
    test('shuffle is a permutation and does not mutate input', () => {
        const source = [1, 2, 3, 4];
        const result = shuffled(source, () => 0);
        expect(result).not.toEqual(source);
        expect([...result].sort()).toEqual(source);
        expect(source).toEqual([1, 2, 3, 4]);
    });
});

describe('library pagination', () => {
    const pages: Record<string, { assets: { id: string }[]; endCursor: string; hasNextPage: boolean }> = {
        start: { assets: [{ id: '2026-a' }, { id: '2026-b' }], endCursor: 'page-2', hasNextPage: true },
        'page-2': { assets: [{ id: '2020-a' }, { id: '2020-b' }], endCursor: 'page-3', hasNextPage: true },
        'page-3': { assets: [{ id: '2010-a' }], endCursor: 'end', hasNextPage: false },
    };
    test('random preparation scans every age and visits each page exactly once', async () => {
        const read = jest.fn(async (after?: string) => pages[after || 'start']);
        const pager = new PhotoSessionPager(read, true);
        const progress = jest.fn();
        await pager.prepare(progress);
        expect(read).toHaveBeenCalledTimes(3);
        expect(progress).toHaveBeenLastCalledWith(5);
        const ids: string[] = [];
        while (pager.hasMore) ids.push(...(await pager.next(() => new Set())).map(a => a.id));
        expect(ids.sort()).toEqual(['2010-a', '2020-a', '2020-b', '2026-a', '2026-b']);
        expect(new Set(ids).size).toBe(ids.length);
        expect(read).toHaveBeenCalledTimes(6);
    });
    test('skips completely reviewed pages instead of reporting an empty library', async () => {
        const pager = new PhotoSessionPager(async after => pages[after || 'start'], false);
        expect(await pager.next(() => new Set(['2026-a', '2026-b']))).toEqual(pages['page-2'].assets);
    });
    test('a failed random fetch retries the same page without losing it', async () => {
        const read = jest.fn(async (after?: string) => pages[after || 'start']);
        const pager = new PhotoSessionPager(read, true);
        await pager.prepare();
        read.mockRejectedValueOnce(new Error('temporary'));
        await expect(pager.next(() => new Set())).rejects.toThrow('temporary');
        const failedCursor = read.mock.calls[read.mock.calls.length - 1][0];
        await pager.next(() => new Set());
        expect(read.mock.calls[read.mock.calls.length - 1][0]).toBe(failedCursor);
    });
    test('cancellation stops an in-flight page from resurfacing', async () => {
        let resolve!: (value: typeof pages.start) => void;
        const read = () => new Promise<typeof pages.start>(res => { resolve = res; });
        const pager = new PhotoSessionPager(read, false);
        const pending = pager.next(() => new Set());
        pager.cancel();
        resolve(pages.start);
        expect(await pending).toEqual([]);
        expect(pager.hasMore).toBe(false);
    });
    test('non-advancing cursors cannot create an infinite loop', async () => {
        const pager = new PhotoSessionPager(async () => ({ assets: [], endCursor: 'same', hasNextPage: true }), false);
        expect(await pager.next(() => new Set())).toEqual([]);
        expect(pager.hasMore).toBe(false);
    });
});

describe('serialized review persistence', () => {
    afterEach(() => jest.useRealTimers());
    test('rapid changes are coalesced and an empty bin is persisted', async () => {
        jest.useFakeTimers();
        const write = jest.fn(async () => {});
        const queue = new ReviewSaveQueue(write, jest.fn());
        queue.schedule(() => [['bin', 'old']]);
        queue.schedule(() => [['bin', '[]'], ['kept', '["saved-id"]']]);
        await queue.flush();
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenLastCalledWith([['bin', '[]'], ['kept', '["saved-id"]']]);
    });
    test('newer snapshots cannot be overtaken by a slow old save', async () => {
        let finishFirst!: () => void;
        const write = jest.fn()
            .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }))
            .mockResolvedValue(undefined);
        const queue = new ReviewSaveQueue(write, jest.fn());
        queue.schedule(() => [['bin', 'old']]);
        const first = queue.flush();
        await Promise.resolve();
        queue.schedule(() => [['bin', 'new']]);
        const second = queue.flush();
        expect(write).toHaveBeenCalledTimes(1);
        finishFirst();
        await Promise.all([first, second]);
        expect(write.mock.calls.map(call => call[0])).toEqual([[['bin', 'old']], [['bin', 'new']]]);
    });
});
test('continuous swiping still checkpoints within the save interval', async () => {
    jest.useFakeTimers();
    const write = jest.fn(async () => {});
    const queue = new ReviewSaveQueue(write, jest.fn(), 250);
    queue.schedule(() => [['kept', 'first']]);
    jest.advanceTimersByTime(200);
    queue.schedule(() => [['kept', 'latest']]);
    jest.advanceTimersByTime(50);
    await queue.flush();
    expect(write).toHaveBeenCalledWith([['kept', 'latest']]);
    jest.useRealTimers();
});
