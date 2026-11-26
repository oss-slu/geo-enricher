
import { jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { geocodeBlockResult } from '../../types/census';
import type {
    AcsColumnMetadata,
    SelectedAcsColumn,
} from '../../utils/acs';
import type { Geocoder } from '../../dataset/enrichDataset';
import {
    readDataset,
    saveDataset,
    type Dataset,
    type FileType,
} from '../../dataset/dataset';
import { FILE_LIMITS } from '../../utils/fileLimits';

const acsMetadata: AcsColumnMetadata[] = [
    {
        table_id: 'b01001',
        column_id: 'b01001001',
        column_title: 'Total:',
    },
];
const getAcsColumnMetadata =
    jest.fn<
        (selections: SelectedAcsColumn[]) => Promise<AcsColumnMetadata[]>
    >();

const queryACSForGeoid =
    jest.fn<
        (
            geoid: string,
            selections: SelectedAcsColumn[],
            validatedMetadata?: AcsColumnMetadata[],
        ) => Promise<Record<string, unknown> | null>
    >();

jest.unstable_mockModule('../../utils/acs', () => ({
    getAcsColumnMetadata,
    queryACSForGeoid,
}));

const { geoSidecar, acsSidecar } = await import('../../dataset/sidecars');
const { enrichFile } = await import('../../dataset/enrichFile');

const addr = '123 Main St, Saint Louis, MO 63103';
const other = '456 Other St, Saint Louis, MO 63103';
const geoid = '291895001001';

const result: geocodeBlockResult = {
    matchedAddress: 'STANDARDIZED',
    latitude: 38,
    longitude: -90,
    blockGeoid: geoid,
    state: '29',
    county: '189',
    tract: '500100',
    blkgrp: '1',
};

const table: Dataset = {
    columns: [
        { id: 'a', label: 'identifier' },
        { id: 'b', label: 'address' },
        { id: 'c', label: 'state' },
    ],
    rows: [
        ['001', addr, 'keep'],
        ['002', other, 'keep'],
        ['003', addr, 'keep'],
        ['004', 'invalid', 'keep'],
    ],
};

const acsColumns: SelectedAcsColumn[] = [
    { table_id: 'B01001', column_id: 'B01001001' },
];

const geocoder: Geocoder = async (address) =>
    address === addr ? result : null;

let root: string;
let sessionId: string;
const previousRoot = process.env.UPLOAD_TEMP_DIR;

beforeEach(async () => {
    root = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'dataset-enrich-file-')),
    );

    process.env.UPLOAD_TEMP_DIR = root;
    sessionId = randomUUID();
    getAcsColumnMetadata.mockResolvedValue(acsMetadata);
    queryACSForGeoid.mockImplementation(async (g) =>
        g === geoid ? { b01001_b01001001: 1234 } : null,
    );
});

afterEach(async () => {
    if (previousRoot === undefined) {
        delete process.env.UPLOAD_TEMP_DIR;
    } else {
        process.env.UPLOAD_TEMP_DIR = previousRoot;
    }

    await fs.rm(root, { recursive: true, force: true });
});

// Upload, then build both sidecars the way the routes do.
async function prepare(type: FileType = 'csv') {
    const { tempPath } = await saveDataset(
        sessionId,
        `input.${type}`,
        table,
        type,
    );

    const geo = await geoSidecar(tempPath, { sessionId }, undefined, geocoder);

    const acs = await acsSidecar(tempPath, {
        sessionId,
        geocodeFile: geo.tempPath,
        acsColumns,
    });

    return {
        inputPath: tempPath,
        geocodeFile: geo.tempPath,
        acsFile: acs.tempPath,
    };
}

it.each(['csv', 'xls', 'xlsx'] as const)(
    'merges geocode and ACS sidecars into a %s output',
    async (type) => {
        const files = await prepare(type);

        const res = await enrichFile(files.inputPath, {
            sessionId,
            geo: true,
            acs: true,
            geocodeFile: files.geocodeFile,
            acsFile: files.acsFile,
        });

        expect(res.filename).toMatch(
            new RegExp(`^input_enriched_\\d{6}_\\d{6}\\.${type}$`),
        );

        expect(res.format).toBe(type);
        expect(res.counts).toEqual({ input: 4, output: 4 });

        // The input's own "state" column forces the geocode one to be renamed.
        expect(res.added).toEqual({
            geocode: [
                'matchedAddress',
                'latitude',
                'longitude',
                'blockGeoid',
                'state_2',
                'county',
                'tract',
                'blkgrp',
            ],
            acs: ['B01001_Total'],
        });

        const output = readDataset(await fs.readFile(res.tempPath), type);

        expect(output.columns.map((c) => c.label)).toEqual([
            'identifier',
            'address',
            'state',
            ...res.added.geocode,
            ...res.added.acs,
        ]);

        expect(output.rows.map((r) => r[0])).toEqual([
            '001',
            '002',
            '003',
            '004',
        ]);

        // CSV reads everything back as text; workbooks keep numbers.
        const num = (n: number) => (type === 'csv' ? String(n) : n);

        expect(output.rows[0].slice(2)).toEqual([
            'keep',
            'STANDARDIZED',
            num(38),
            num(-90),
            geoid,
            '29',
            '189',
            '500100',
            '1',
            num(1234),
        ]);

        expect(output.rows[1].slice(3)).toEqual(
            Array(9).fill(type === 'csv' ? '' : null),
        );
    },
);

// Sidecar numbers are read back as text; they must not hit the CSV formula guard.
it('writes negative sidecar numbers to CSV without escaping', async () => {
    const files = await prepare();

    const res = await enrichFile(files.inputPath, {
        sessionId,
        geo: true,
        geocodeFile: files.geocodeFile,
        fields: ['longitude'],
    });

    const output = readDataset(await fs.readFile(res.tempPath), 'csv');

    expect(output.rows[0][3]).toBe('-90');
});

it.each(['xls', 'xlsx'] as const)(
    'leaves unmatched cells empty in %s output',
    async (type) => {
        const files = await prepare(type);

        const res = await enrichFile(files.inputPath, {
            sessionId,
            geo: true,
            geocodeFile: files.geocodeFile,
        });

        const output = readDataset(await fs.readFile(res.tempPath), type);

        expect(output.rows[1].slice(3)).toEqual(Array(8).fill(null));
    },
);

it('merges only the selected geocode fields', async () => {
    const files = await prepare();

    const res = await enrichFile(files.inputPath, {
        sessionId,
        geo: true,
        geocodeFile: files.geocodeFile,
        fields: ['latitude', 'longitude'],
    });

    expect(res.added).toEqual({
        geocode: ['latitude', 'longitude'],
        acs: [],
    });

    const output = readDataset(await fs.readFile(res.tempPath), 'csv');

    expect(output.rows[2]).toEqual(['003', addr, 'keep', '38', '-90']);
});

it('merges ACS data alone', async () => {
    const files = await prepare();

    const res = await enrichFile(files.inputPath, {
        sessionId,
        acs: true,
        acsFile: files.acsFile,
    });

    expect(res.added).toEqual({
        geocode: [],
        acs: ['B01001_Total'],
    });

    const output = readDataset(await fs.readFile(res.tempPath), 'csv');

    expect(output.rows.map((r) => r[3])).toEqual([
        '1234',
        '',
        '1234',
        '',
    ]);
});

it('drops unmatched rows on an inner join', async () => {
    const files = await prepare();

    const res = await enrichFile(files.inputPath, {
        sessionId,
        geo: true,
        geocodeFile: files.geocodeFile,
        join: 'inner',
    });

    expect(res.counts).toEqual({ input: 4, output: 2 });

    const output = readDataset(await fs.readFile(res.tempPath), 'csv');

    expect(output.rows.map((r) => r[0])).toEqual(['001', '003']);
});

it('uses a custom output filename with a timestamp', async () => {
    const files = await prepare();

    const res = await enrichFile(files.inputPath, {
        sessionId,
        geo: true,
        geocodeFile: files.geocodeFile,
        outputName: 'Fall Enrollment',
    });

    expect(res.filename).toMatch(
        /^Fall_Enrollment_enriched_\d{6}_\d{6}\.csv$/,
    );
});

it('requires something to be selected', async () => {
    await expect(
        enrichFile(path.join(root, sessionId, 'input.csv'), { sessionId }),
    ).rejects.toMatchObject({ status: 400, code: 'NOTHING_SELECTED' });
});

it.each([
    ['geo', 'geocodeFile is required when geo is true'],
    ['acs', 'acsFile is required when acs is true'],
])('requires a sidecar file when %s is selected', async (key, message) => {
    const { inputPath } = await prepare();

    await expect(
        enrichFile(inputPath, { sessionId, [key]: true }),
    ).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_OPTIONS',
        message,
    });
});

it('rejects invalid options before reading files', async () => {
    await expect(
        enrichFile('/nope.csv', { sessionId, geo: true, join: 'outer' }),
    ).rejects.toMatchObject({ code: 'INVALID_JOIN' });

    await expect(enrichFile('/nope.csv', null)).rejects.toMatchObject({
        code: 'INVALID_OPTIONS',
    });
});

it('rejects a non-sidecar file passed as a sidecar', async () => {
    const files = await prepare();

    await expect(
        enrichFile(files.inputPath, {
            sessionId,
            geo: true,
            geocodeFile: files.inputPath,
        }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_SIDECAR' });
});

it('rejects outputs over the column limit', async () => {
    // Wide enough for the geocode sidecar alone, too wide once ACS is added.
    const width = FILE_LIMITS.columns - 8;

    const wide: Dataset = {
        columns: Array.from({ length: width }, (_, i) => ({
            id: `c${i}`,
            label: i === 0 ? 'address' : `col${i}`,
        })),
        rows: [
            Array.from({ length: width }, (_, i) => (i === 0 ? addr : 'x')),
        ],
    };

    const { tempPath } = await saveDataset(
        sessionId,
        'wide.csv',
        wide,
        'csv',
    );

    const geo = await geoSidecar(tempPath, { sessionId }, undefined, geocoder);

    const acs = await acsSidecar(tempPath, {
        sessionId,
        geocodeFile: geo.tempPath,
        acsColumns,
    });

    await expect(
        enrichFile(tempPath, {
            sessionId,
            geo: true,
            acs: true,
            geocodeFile: geo.tempPath,
            acsFile: acs.tempPath,
        }),
    ).rejects.toMatchObject({ status: 413, code: 'TABLE_TOO_LARGE' });
});

it('honors an already-aborted signal', async () => {
    const files = await prepare();
    const controller = new AbortController();

    controller.abort();

    await expect(
        enrichFile(
            files.inputPath,
            { sessionId, geo: true, geocodeFile: files.geocodeFile },
            controller.signal,
        ),
    ).rejects.toMatchObject({ status: 504, code: 'CANCELLED' });
});
