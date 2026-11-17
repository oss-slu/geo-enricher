import { FileError } from '../errs/file';
import { FILE_LIMITS } from './fileLimits';
import { queryACSForGeoid } from './acs';
import { resolveColumn } from './fileHelpers';
import type { Dataset, Cell, Column } from './dataset';
import type { SelectedAcsColumn } from './enrichFile';

const acsKey = (s: SelectedAcsColumn) =>
    `${s.table_id.toLowerCase()}_${s.column_id.toLowerCase()}`;

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
            results.set(geoid, await queryACSForGeoid(geoid, acsColumns));
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(FILE_LIMITS.concurrency, geoids.length) }, worker),
    );
    check();

    const newColumns: Column[] = acsColumns.map((s) => ({
        id: `acs_${acsKey(s)}`,
        label: `${s.table_id.toUpperCase()} ${s.column_id.toUpperCase()}`,
    }));

    const rows = dataset.rows.map((row) => {
        const geoid = row[geoidIndex];
        const acsRow = typeof geoid === 'string' ? results.get(geoid) : null;

        return [
            ...row,
            ...acsColumns.map((s) => {
                const v = acsRow?.[acsKey(s)];
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