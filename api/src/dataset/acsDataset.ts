import { FileError } from '../errs/file';
import { FILE_LIMITS } from '../utils/fileLimits';
import {
    getAcsColumnMetadata,
    queryACSForGeoid,
} from '../utils/acs';
import type { SelectedAcsColumn } from '../utils/acs';
import { resolveColumn } from '../utils/fileHelpers';
import type { Dataset, Cell, Column } from './dataset';

const acsKey = (s: SelectedAcsColumn) =>
    `${s.table_id.toLowerCase()}_${s.column_id.toLowerCase()}`;

function formatColumnTitle(title: string): string {
    return title
        .trim()
        .replace(/:\s*$/u, '')
        .replace(/\s+/gu, '_');
}

function isCell(v: unknown): v is Cell {
    return (
        v === null || typeof v === 'string' || typeof v === 'number' ||
        typeof v === 'boolean' || v instanceof Date
    );
}

export async function appendAcs(
    dataset: Dataset,
    geoidField: string,
    acsColumns: SelectedAcsColumn[],
    check: () => void,
) {
    if (dataset.columns.length + acsColumns.length > FILE_LIMITS.columns) {
        throw new FileError(413, 'TABLE_TOO_LARGE', 'Enriched dataset exceeds column limit');
    }

    const geoidId = resolveColumn(
        dataset,
        geoidField,
        'GEOID_FIELD_NOT_FOUND',
        'Select one GEOID column by its unique ID or label',
    );
    const geoidIndex = dataset.columns.findIndex((c) => c.id === geoidId);

    // Retrieve and validate the selected ACS column metadata once.
    check();
    const metadata = await getAcsColumnMetadata(acsColumns);
    check();

    const metadataByKey = new Map(
        metadata.map((item) => [
            `${item.table_id}:${item.column_id}`,
            item,
        ]),
    );

    // Query each unique GEOID once, with bounded concurrency.
    const geoids = [
        ...new Set(
            dataset.rows
                .map((r) => r[geoidIndex])
                .filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
        ),
    ];

    const results = new Map<string, Record<string, unknown> | null>();
    let cursor = 0;

    const worker = async () => {
        while (cursor < geoids.length) {
            check();
            const geoid = geoids[cursor++];
            results.set(
                geoid,
                await queryACSForGeoid(geoid, acsColumns, metadata),
            );
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(FILE_LIMITS.concurrency, geoids.length) }, worker),
    );
    check();

    const newColumns: Column[] = acsColumns.map((selection) => {
        const key =
            `${selection.table_id.toLowerCase()}:${selection.column_id.toLowerCase()}`;
        const columnMetadata = metadataByKey.get(key);

        if (!columnMetadata) {
            throw new FileError(
                400,
                'INVALID_ACS_COLUMNS',
                `Missing ACS metadata for ${selection.table_id}.${selection.column_id}`,
            );
        }

        return {
            id: `acs_${acsKey(selection)}`,
            label: `${selection.table_id.toUpperCase()}_${formatColumnTitle(columnMetadata.column_title)}`,
        };
    });

    const rows = dataset.rows.map((row) => {
        const geoid = row[geoidIndex];
        const acsRow = typeof geoid === 'string' ? results.get(geoid) : null;

        return [
            ...row,
            ...acsColumns.map((selection) => {
                const v = acsRow?.[acsKey(selection)];
                return isCell(v) ? v : null;
            }),
        ];
    });

    return {
        dataset: { columns: [...dataset.columns, ...newColumns], rows },
        newColumns,
        counts: {
            input: dataset.rows.length,
            uniqueGeoids: geoids.length,
            withAcs: rows.filter((_, i) => {
                const g = dataset.rows[i][geoidIndex];
                return typeof g === 'string' && results.get(g);
            }).length,
        },
    };
}
