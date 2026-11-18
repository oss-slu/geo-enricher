import { jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { geocodeBlockResult } from '../../types/census';
import type { SelectedAcsColumn } from '../../utils/acs';
import type { Geocoder } from '../../dataset/enrichDataset';
import { readDataset, saveDataset, type Dataset } from '../../dataset/dataset';

const queryACSForGeoid =
    jest.fn<
        (
            geoid: string,
            selections: SelectedAcsColumn[],
        ) => Promise<Record<string, unknown> | null>
    >();
jest.unstable_mockModule('../../utils/acs', () => ({ queryACSForGeoid }));
const { geoSidecar, acsSidecar } = await import('../../dataset/sidecars');

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
    ],
    rows: [
        ['001', addr],
        ['002', other],
        ['003', addr],
        ['004', 'invalid'],
    ],
};
const acsColumns: SelectedAcsColumn[] = [
    { table_id: 'B01001', column_id: 'B01001001' },
];
const geocoder = jest.fn<Geocoder>(async (address) =>
    address === addr ? result : null,
);

let root: string;
let sessionId: string;
let inputPath: string;
const previousRoot = process.env.UPLOAD_TEMP_DIR;

beforeEach(async () => {
    // Session paths are canonical; macOS tmpdir is behind a symlink.
    root = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'dataset-sidecars-')),
    );
    process.env.UPLOAD_TEMP_DIR = root;
    sessionId = randomUUID();
    ({ tempPath: inputPath } = await saveDataset(
        sessionId,
        'input.csv',
        table,
        'csv',
    ));
    queryACSForGeoid.mockImplementation(async (g) =>
        g === geoid ? { b01001_b01001001: 1234 } : null,
    );
});

afterEach(async () => {
    if (previousRoot === undefined) delete process.env.UPLOAD_TEMP_DIR;
    else process.env.UPLOAD_TEMP_DIR = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
});

const readOutput = async (p: string) =>
    readDataset(await fs.readFile(p), 'csv');

describe('geoSidecar', () => {
    it('writes a row-indexed geocode sidecar and returns a preview', async () => {
        const res = await geoSidecar(
            inputPath,
            { sessionId },
            undefined,
            geocoder,
        );

        expect(res.filename).toBe('geocode_input.csv');
        expect(path.dirname(res.tempPath)).toBe(path.join(root, sessionId));
        expect(res.addressField).toBe('field2');
        expect(res.counts).toEqual({
            input: 4,
            output: 4,
            matched: 2,
            unmatched: 1,
            invalidOrBlank: 1,
        });
        expect(geocoder).toHaveBeenCalledTimes(2);

        const sidecar = await readOutput(res.tempPath);
        expect(sidecar.columns.map((c) => c.label)).toEqual([
            '_row',
            '_address',
            'matchedAddress',
            'latitude',
            'longitude',
            'blockGeoid',
            'state',
            'county',
            'tract',
            'blkgrp',
        ]);
        expect(sidecar.rows.map((r) => r[0])).toEqual(['0', '1', '2', '3']);
        expect(sidecar.rows[0]).toEqual([
            '0',
            addr,
            'STANDARDIZED',
            '38',
            '-90',
            geoid,
            '29',
            '189',
            '500100',
            '1',
        ]);
        expect(sidecar.rows[1].slice(2)).toEqual(Array(8).fill(''));

        expect(res.preview.columns.map((c) => c.label)).toEqual([
            'identifier',
            'address',
            'matchedAddress',
            'latitude',
            'longitude',
            'blockGeoid',
            'state',
            'county',
            'tract',
            'blkgrp',
        ]);
        expect(res.preview.rows).toHaveLength(4);
    });

    it('uses the requested address column and overwrites previous sidecars', async () => {
        const first = await geoSidecar(
            inputPath,
            { sessionId, addressField: 'address' },
            undefined,
            geocoder,
        );
        const second = await geoSidecar(
            inputPath,
            { sessionId, addressField: 'field2' },
            undefined,
            async () => null,
        );
        expect(second.tempPath).toBe(first.tempPath);
        expect(second.counts.matched).toBe(0);
    });

    it('rejects an unknown address column', async () => {
        await expect(
            geoSidecar(
                inputPath,
                { sessionId, addressField: 'nope' },
                undefined,
                geocoder,
            ),
        ).rejects.toMatchObject({
            status: 422,
            code: 'ADDRESS_FIELD_NOT_FOUND',
        });
        expect(geocoder).not.toHaveBeenCalled();
    });

    it('rejects invalid options and already-aborted signals', async () => {
        await expect(
            geoSidecar(inputPath, { sessionId: 'bad' }, undefined, geocoder),
        ).rejects.toMatchObject({ code: 'INVALID_SESSION' });

        const controller = new AbortController();
        controller.abort();
        await expect(
            geoSidecar(inputPath, { sessionId }, controller.signal, geocoder),
        ).rejects.toMatchObject({ status: 504, code: 'CANCELLED' });
        expect(geocoder).not.toHaveBeenCalled();
    });
});

describe('acsSidecar', () => {
    const geocodeFirst = () =>
        geoSidecar(inputPath, { sessionId }, undefined, geocoder);

    it('writes ACS values keyed by row from a geocode sidecar', async () => {
        const geo = await geocodeFirst();
        const res = await acsSidecar(inputPath, {
            sessionId,
            geocodeFile: geo.tempPath,
            acsColumns,
        });

        expect(res.filename).toBe('acs_input.csv');
        expect(queryACSForGeoid).toHaveBeenCalledTimes(1);
        expect(queryACSForGeoid).toHaveBeenCalledWith(geoid, acsColumns);
        expect(res.counts).toEqual({ input: 4, uniqueGeoids: 1, withAcs: 2 });

        const sidecar = await readOutput(res.tempPath);
        expect(sidecar.columns.map((c) => c.label)).toEqual([
            '_row',
            '_address',
            'B01001 B01001001',
        ]);
        expect(sidecar.rows).toEqual([
            ['0', addr, '1234'],
            ['1', other, ''],
            ['2', addr, '1234'],
            ['3', 'invalid', ''],
        ]);

        // Preview omits the _row column.
        expect(res.preview.columns.map((c) => c.label)).toEqual([
            '_address',
            'B01001 B01001001',
        ]);
        expect(res.preview.rows[0]).toEqual([addr, 1234]);
    });

    it('requires nonempty acsColumns before touching the session', async () => {
        for (const opts of [{}, { acsColumns: [] }]) {
            await expect(
                acsSidecar(inputPath, {
                    sessionId,
                    geocodeFile: 'x.csv',
                    ...opts,
                }),
            ).rejects.toMatchObject({
                status: 400,
                code: 'INVALID_ACS_COLUMNS',
            });
        }
    });

    it('requires a geocodeFile', async () => {
        await expect(
            acsSidecar(inputPath, { sessionId, acsColumns }),
        ).rejects.toMatchObject({ status: 400, code: 'INVALID_OPTIONS' });
    });

    it('rejects geocode files that are not sidecars', async () => {
        await expect(
            acsSidecar(inputPath, {
                sessionId,
                geocodeFile: inputPath,
                acsColumns,
            }),
        ).rejects.toMatchObject({ status: 422, code: 'INVALID_SIDECAR' });
    });

    it('rejects sidecars without a blockGeoid column', async () => {
        const { tempPath } = await saveDataset(
            sessionId,
            'geocode_bad.csv',
            {
                columns: [
                    { id: '_row', label: '_row' },
                    { id: 'x', label: 'x' },
                ],
                rows: [[0, 'y']],
            },
            'csv',
        );
        await expect(
            acsSidecar(inputPath, {
                sessionId,
                geocodeFile: tempPath,
                acsColumns,
            }),
        ).rejects.toMatchObject({ status: 422, code: 'GEOID_FIELD_NOT_FOUND' });
        expect(queryACSForGeoid).not.toHaveBeenCalled();
    });

    it('surfaces missing geocode files as 404', async () => {
        await expect(
            acsSidecar(inputPath, {
                sessionId,
                geocodeFile: path.join(root, sessionId, 'geocode_none.csv'),
                acsColumns,
            }),
        ).rejects.toMatchObject({ status: 404 });
    });
});
