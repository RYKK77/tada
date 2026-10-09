import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Exercise the production TypeScript through Vite without starting an HTTP server.
process.env.TZ = 'Asia/Shanghai';
const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: 'custom',
});
after(() => server.close());
const { getTaskDateContext, resolveAiTaskDates } = await server.ssrLoadModule(
    '/packages/core/src/services/ai/taskDates.ts',
);

test('preserves tomorrow 13:00–18:00 from the AI response over the default due date', () => {
    const dates = resolveAiTaskDates({
        startDate: '2026-10-09T13:00:00+08:00',
        dueDate: '2026-10-09T18:00:00+08:00',
    }, new Date(2026, 9, 8));
    assert.equal(dates.startDate, new Date(2026, 9, 9, 13).getTime());
    assert.equal(dates.dueDate, new Date(2026, 9, 9, 18).getTime());
});

test('date-only values stay at local midnight instead of becoming 08:00', () => {
    const dates = resolveAiTaskDates({ startDate: '2026-10-09', dueDate: '2026-10-10' });
    assert.equal(dates.startDate, new Date(2026, 9, 9).getTime());
    assert.equal(dates.dueDate, new Date(2026, 9, 10).getTime());
});

test('preserves minutes, overnight ranges and equivalent UTC timestamps', () => {
    const local = resolveAiTaskDates({
        startDate: '2026-10-09T23:15:00+08:00',
        dueDate: '2026-10-10T01:45:00+08:00',
    });
    const utc = resolveAiTaskDates({
        startDate: '2026-10-09T15:15:00Z',
        dueDate: '2026-10-09T17:45:00Z',
    });
    assert.deepEqual(local, utc);
    assert.equal(local.startDate, new Date(2026, 9, 9, 23, 15).getTime());
    assert.equal(local.dueDate, new Date(2026, 9, 10, 1, 45).getTime());
});

test('does not invent a start time when only an end is available', () => {
    assert.deepEqual(resolveAiTaskDates({ startDate: null, dueDate: '2026-10-09' }), {
        startDate: null,
        dueDate: new Date(2026, 9, 9).getTime(),
    });
    assert.deepEqual(resolveAiTaskDates({ startDate: '2026-10-09T13:00:00', dueDate: null }), {
        startDate: new Date(2026, 9, 9, 13).getTime(),
        dueDate: null,
    });
});

test('missing or invalid dates use the due-date preference without storing NaN', () => {
    const fallback = new Date(2026, 9, 10, 17, 30);
    for (const value of [null, undefined, '', 'null', 'not-a-date']) {
        assert.deepEqual(resolveAiTaskDates({ startDate: value, dueDate: value }, fallback), {
            startDate: null,
            dueDate: fallback.getTime(),
        });
        assert.deepEqual(resolveAiTaskDates({ startDate: value, dueDate: value }), {
            startDate: null,
            dueDate: null,
        });
    }
});

test('relative-date prompt context uses the local calendar day and explicit offset', () => {
    assert.deepEqual(getTaskDateContext(new Date('2026-10-08T16:30:00Z')), {
        currentDate: '2026-10-09',
        currentDateTime: '2026-10-09T00:30:00+08:00',
        timeZone: 'Asia/Shanghai',
    });
});

test('10 AM plus an extracted half-hour duration creates a 10:00–10:30 interval', () => {
    const dates = resolveAiTaskDates({
        startDate: '2026-10-09T10:00:00+08:00',
        dueDate: null,
        durationMinutes: 30,
    }, new Date(2026, 9, 8));
    assert.deepEqual(dates, {
        startDate: new Date(2026, 9, 9, 10).getTime(),
        dueDate: new Date(2026, 9, 9, 10, 30).getTime(),
    });
});

test('duration arithmetic preserves minutes and rolls over hours and days', () => {
    for (const [start, durationMinutes, expectedEnd] of [
        ['2026-10-09T10:45:00+08:00', 30, new Date(2026, 9, 9, 11, 15)],
        ['2026-10-09T10:00:00+08:00', 90, new Date(2026, 9, 9, 11, 30)],
        ['2026-10-09T10:00:00+08:00', 80, new Date(2026, 9, 9, 11, 20)],
        ['2026-10-09T23:45:00+08:00', 30, new Date(2026, 9, 10, 0, 15)],
        ['2026-12-31T23:45:00+08:00', 30, new Date(2027, 0, 1, 0, 15)],
    ]) {
        const dates = resolveAiTaskDates({ startDate: start, dueDate: null, durationMinutes });
        assert.equal(dates.dueDate, expectedEnd.getTime());
    }
});

test('an explicit end time takes precedence over an estimated duration', () => {
    const dates = resolveAiTaskDates({
        startDate: '2026-10-09T10:00:00+08:00',
        dueDate: '2026-10-09T11:00:00+08:00',
        durationMinutes: 30,
    });
    assert.equal(dates.dueDate, new Date(2026, 9, 9, 11).getTime());
});

test('duration recovers missing, date-only and non-increasing AI end times', () => {
    for (const dueDate of [undefined, null, 'invalid', '2026-10-09', '2026-10-09T10:00:00+08:00', '2026-10-09T09:00:00+08:00']) {
        const dates = resolveAiTaskDates({
            startDate: '2026-10-09T10:00:00+08:00',
            dueDate,
            durationMinutes: 30,
        });
        assert.equal(dates.dueDate, new Date(2026, 9, 9, 10, 30).getTime());
    }
});

test('duration alone or with a date-only start does not invent an event time', () => {
    for (const startDate of [null, undefined, 'invalid', '2026-10-09']) {
        const dates = resolveAiTaskDates({ startDate, dueDate: null, durationMinutes: 30 });
        assert.equal(dates.dueDate, null);
    }
});

test('absent or invalid durations preserve the existing due-date fallback', () => {
    const fallback = new Date(2026, 9, 10);
    for (const durationMinutes of [undefined, null, 0, -30, NaN, Infinity, '30', Number.MAX_VALUE]) {
        const dates = resolveAiTaskDates({
            startDate: '2026-10-09T10:00:00+08:00',
            dueDate: null,
            durationMinutes,
        }, fallback);
        assert.equal(dates.dueDate, fallback.getTime());
    }
});

test('duration uses elapsed minutes across a daylight-saving transition', () => {
    const dates = resolveAiTaskDates({
        startDate: '2026-03-08T01:45:00-05:00',
        dueDate: null,
        durationMinutes: 30,
    });
    assert.equal(dates.dueDate, Date.parse('2026-03-08T03:15:00-04:00'));
    assert.equal(dates.dueDate - dates.startDate, 30 * 60_000);
});
