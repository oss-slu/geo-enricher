import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    isDatasetCell,
    loadDataset,
    parseFileOptions,
} from '../../dataset/shared';
import { saveDataset, type Dataset } from '../../dataset/dataset';

const sessionId = randomUUID();

describe('isDatasetCell', () => {
    it.each([null, '', 'text', 0, 1.5, true, false, new Date(0)])(
        'accepts %p',
        (value) => {
            expect(isDatasetCell(value)).toBe(true);
        },
    );

    it.each([undefined, {}, [], () => {}, Symbol('x'), 10n])(
        'rejects %p',
        (value) => {
            expect(isDatasetCell(value)).toBe(false);
        },
    );
});

describe('parseFileOptions', () => {
    it('returns valid options unchanged', () => {
        const body = {
            sessionId,
            hasHeaders: false,
            sheet: 'Sheet1',
            addressField: 'field2',
            geocodeFile: 'geocode_input.csv',
            acsFile: 'acs_input.csv',
            fields: ['state'],
            join: 'inner',
            acsColumns: [{ table_id: 'B01001', column_id: 'B01001001' }],
        };
        expect(parseFileOptions(body)).toBe(body);
    });

    it.each([undefined, null, 'string', 1, []])(
        'rejects non-object body %p',
        (value) => {
            expect(() => parseFileOptions(value)).toThrow(
                expect.objectContaining({
                    status: 400,
                    code: 'INVALID_OPTIONS',
                }),
            );
        },
    );

    it('rejects missing or malformed session ids', () => {
        expect(() => parseFileOptions({})).toThrow(
            expect.objectContaining({ code: 'INVALID_SESSION' }),
        );
        expect(() => parseFileOptions({ sessionId: 'abc' })).toThrow(
            expect.objectContaining({ code: 'INVALID_SESSION' }),
        );
    });

    it('validates geocode fields and join', () => {
        expect(() => parseFileOptions({ sessionId, fields: ['nope'] })).toThrow(
            expect.objectContaining({ code: 'INVALID_FIELDS' }),
        );
        expect(() => parseFileOptions({ sessionId, join: 'outer' })).toThrow(
            expect.objectContaining({ code: 'INVALID_JOIN' }),
        );
    });

    it('rejects non-boolean hasHeaders', () => {
        expect(() =>
            parseFileOptions({ sessionId, hasHeaders: 'true' }),
        ).toThrow(
            expect.objectContaining({ status: 400, code: 'INVALID_HEADERS' }),
        );
    });

    it.each(['sheet', 'addressField', 'geocodeFile', 'acsFile'])(
        'rejects empty or non-string %s',
        (key) => {
            for (const value of ['', 1, true]) {
                expect(() =>
                    parseFileOptions({ sessionId, [key]: value }),
                ).toThrow(
                    expect.objectContaining({
                        status: 400,
                        code: 'INVALID_OPTIONS',
                        message: `${key} must be a nonempty string`,
                    }),
                );
            }
        },
    );

    it.each([
        ['non-array', { table_id: 'b01001', column_id: 'b01001001' }],
        ['null entry', [null]],
        ['missing column_id', [{ table_id: 'b01001' }]],
        ['blank table_id', [{ table_id: '  ', column_id: 'b01001001' }]],
        [
            'case-insensitive duplicate',
            [
                { table_id: 'b01001', column_id: 'b01001001' },
                { table_id: 'B01001', column_id: 'B01001001' },
            ],
        ],
    ])('rejects acsColumns: %s', (_, acsColumns) => {
        expect(() => parseFileOptions({ sessionId, acsColumns })).toThrow(
            expect.objectContaining({
                status: 400,
                code: 'INVALID_ACS_COLUMNS',
            }),
        );
    });
});

describe('loadDataset', () => {
    let root: string;
    const previousRoot = process.env.UPLOAD_TEMP_DIR;
    const table: Dataset = {
        columns: [
            { id: 'a', label: 'id' },
            { id: 'b', label: 'address' },
        ],
        rows: [
            ['001', '123 Main St'],
            ['002', '456 Oak St'],
        ],
    };

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'dataset-shared-'));
        process.env.UPLOAD_TEMP_DIR = root;
    });

    afterEach(async () => {
        if (previousRoot === undefined) delete process.env.UPLOAD_TEMP_DIR;
        else process.env.UPLOAD_TEMP_DIR = previousRoot;
        await fs.rm(root, { recursive: true, force: true });
    });

    it.each(['csv', 'xlsx'] as const)(
        'reads a %s session file and reports its type',
        async (type) => {
            const { tempPath } = await saveDataset(
                sessionId,
                `input.${type}`,
                table,
                type,
            );
            const loaded = await loadDataset(tempPath, { sessionId });
            expect(loaded.type).toBe(type);
            expect(loaded.dataset.columns.map((c) => c.label)).toEqual([
                'id',
                'address',
            ]);
            expect(loaded.dataset.rows).toEqual(table.rows);
        },
    );

    it('honors hasHeaders: false', async () => {
        const { tempPath } = await saveDataset(
            sessionId,
            'input.csv',
            table,
            'csv',
        );
        const { dataset } = await loadDataset(tempPath, {
            sessionId,
            hasHeaders: false,
        });
        expect(dataset.rows[0]).toEqual(['id', 'address']);
        expect(dataset.rows).toHaveLength(3);
    });

    it('rejects files outside the session', async () => {
        const { tempPath } = await saveDataset(
            sessionId,
            'input.csv',
            table,
            'csv',
        );
        await expect(
            loadDataset(tempPath, { sessionId: randomUUID() }),
        ).rejects.toMatchObject({ status: 404 });
    });
});
