import { jest } from '@jest/globals';
import type { SelectedAcsColumn } from '../../utils/acs';
import type { Dataset } from '../../dataset/dataset';
import { FILE_LIMITS } from '../../utils/fileLimits';

const queryACSForGeoid =
    jest.fn<
        (
            geoid: string,
            selections: SelectedAcsColumn[],
        ) => Promise<Record<string, unknown> | null>
    >();
jest.unstable_mockModule('../../utils/acs', () => ({ queryACSForGeoid }));
const { appendAcs } = await import('../../dataset/acsDataset');

const g1 = '290000000001';
const g2 = '290000000002';
const missing = '290000000003';
const acsColumns: SelectedAcsColumn[] = [
    { table_id: 'B01001', column_id: 'B01001001' },
    { table_id: 'b19013', column_id: 'b19013001' },
];
const table: Dataset = {
    columns: [
        { id: 'name', label: 'name' },
        { id: 'geo', label: 'geoid' },
    ],
    rows: [
        ['first', g1],
        ['second', g2],
        ['duplicate', g1],
        ['no data', missing],
        ['blank', '  '],
        ['null', null],
    ],
};
const noop = () => {};

beforeEach(() => {
    queryACSForGeoid.mockImplementation(async (geoid) => {
        if (geoid === g1)
            return { b01001_b01001001: 100, b19013_b19013001: 50000 };
        // Non-cell values (objects, undefined) should become null.
        if (geoid === g2)
            return { b01001_b01001001: '200', b19013_b19013001: { bad: 1 } };
        return null;
    });
});

it('appends ACS columns, querying each unique GEOID once', async () => {
    const result = await appendAcs(table, 'geoid', acsColumns, noop);

    expect(queryACSForGeoid.mock.calls.map((c) => c[0]).sort()).toEqual(
        [g1, g2, missing].sort(),
    );
    expect(queryACSForGeoid).toHaveBeenCalledWith(g1, acsColumns);
    expect(result.newColumns).toEqual([
        { id: 'acs_b01001_b01001001', label: 'B01001 B01001001' },
        { id: 'acs_b19013_b19013001', label: 'B19013 B19013001' },
    ]);
    expect(result.dataset.columns).toEqual([
        ...table.columns,
        ...result.newColumns,
    ]);
    expect(result.dataset.rows).toEqual([
        ['first', g1, 100, 50000],
        ['second', g2, '200', null],
        ['duplicate', g1, 100, 50000],
        ['no data', missing, null, null],
        ['blank', '  ', null, null],
        ['null', null, null, null],
    ]);
    expect(result.counts).toEqual({ input: 6, uniqueGeoids: 3, withAcs: 3 });
});

it('does not mutate the input dataset', async () => {
    const before = structuredClone(table);
    await appendAcs(table, 'geoid', acsColumns, noop);
    expect(table).toEqual(before);
});

it('resolves the GEOID column by id as well as label', async () => {
    const result = await appendAcs(table, 'geo', acsColumns, noop);
    expect(result.counts.uniqueGeoids).toBe(3);
});

it('rejects unknown or ambiguous GEOID columns', async () => {
    await expect(
        appendAcs(table, 'missing', acsColumns, noop),
    ).rejects.toMatchObject({ status: 422, code: 'GEOID_FIELD_NOT_FOUND' });

    const ambiguous: Dataset = {
        columns: [
            { id: 'a', label: 'geoid' },
            { id: 'b', label: 'geoid' },
        ],
        rows: [[g1, g2]],
    };
    await expect(
        appendAcs(ambiguous, 'geoid', acsColumns, noop),
    ).rejects.toMatchObject({ status: 422, code: 'GEOID_FIELD_NOT_FOUND' });
    expect(queryACSForGeoid).not.toHaveBeenCalled();
});

it('rejects selections that would exceed the column limit', async () => {
    const tooMany = Array.from(
        { length: FILE_LIMITS.columns - table.columns.length + 1 },
        (_, i) => ({ table_id: 't', column_id: `c${i}` }),
    );
    await expect(
        appendAcs(table, 'geoid', tooMany, noop),
    ).rejects.toMatchObject({ status: 413, code: 'TABLE_TOO_LARGE' });
    expect(queryACSForGeoid).not.toHaveBeenCalled();
});

it('bounds query concurrency', async () => {
    let concurrent = 0,
        peak = 0;
    queryACSForGeoid.mockImplementation(async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 2));
        concurrent--;
        return {};
    });
    const many: Dataset = {
        columns: [{ id: 'geo', label: 'geoid' }],
        rows: Array.from({ length: 12 }, (_, i) => [
            String(i).padStart(12, '0'),
        ]),
    };
    const result = await appendAcs(many, 'geoid', acsColumns, noop);
    expect(queryACSForGeoid).toHaveBeenCalledTimes(12);
    expect(peak).toBe(FILE_LIMITS.concurrency);
    // Empty rows are truthy, so every GEOID counts as having ACS data.
    expect(result.counts.withAcs).toBe(12);
});

it('stops when check throws and propagates query errors', async () => {
    const cancelled = new Error('cancelled');
    await expect(
        appendAcs(table, 'geoid', acsColumns, () => {
            throw cancelled;
        }),
    ).rejects.toBe(cancelled);
    expect(queryACSForGeoid).not.toHaveBeenCalled();

    queryACSForGeoid.mockRejectedValue(new Error('db down'));
    await expect(appendAcs(table, 'geoid', acsColumns, noop)).rejects.toThrow(
        'db down',
    );
});

it('handles datasets with no GEOIDs without querying', async () => {
    const empty: Dataset = {
        columns: [{ id: 'geo', label: 'geoid' }],
        rows: [[null], ['']],
    };
    const result = await appendAcs(empty, 'geoid', acsColumns, noop);
    expect(queryACSForGeoid).not.toHaveBeenCalled();
    expect(result.dataset.rows).toEqual([
        [null, null, null],
        ['', null, null],
    ]);
    expect(result.counts).toEqual({ input: 2, uniqueGeoids: 0, withAcs: 0 });
});
