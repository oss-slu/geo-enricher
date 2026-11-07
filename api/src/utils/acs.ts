import { query } from '../db/connect';
import { FileError } from '../errs/file';

export type SelectedAcsColumn = {
    table_id: string;
    column_id: string;
};

type MetadataRow = {
    table_id: string;
    column_id: string;
};

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

export function normalizeGeoid(value: unknown): string {
    if (typeof value !== 'string') {
    throw new FileError(
        400,
        'INVALID_GEOID',
        'GEOID must be a 12-digit block-group GEOID',
    );
}

    const match = /^(?:15000US)?(\d{12})$/iu.exec(value.trim());

    if (!match) {
        throw new FileError(
            400,
            'INVALID_GEOID',
            'GEOID must be a 12-digit block-group GEOID',
        );
    }

    return `15000US${match[1]}`;
}

export async function queryACSForGeoid(
    geoid: string,
    selections: SelectedAcsColumn[],
): Promise<Record<string, unknown> | null> {
    const normalizedGeoid = normalizeGeoid(geoid);

    if (!selections.length) return {};

    const metadata = await query<MetadataRow>(
        `SELECT lower(table_id) AS table_id, lower(column_id) AS column_id
         FROM acs.census_column_metadata
         WHERE (lower(table_id), lower(column_id)) IN (
             SELECT lower(selection.table_id), lower(selection.column_id)
             FROM unnest($1::text[], $2::text[])
                 AS selection(table_id, column_id)
         )`,
        [
            selections.map((item) => item.table_id),
            selections.map((item) => item.column_id),
        ],
    );

    const validPairs = new Set(
        metadata.rows.map((row) => `${row.table_id}:${row.column_id}`),
    );

    for (const selection of selections) {
        const key =
            `${selection.table_id.toLowerCase()}:${selection.column_id.toLowerCase()}`;

        if (!validPairs.has(key)) {
            throw new FileError(
                400,
                'INVALID_ACS_COLUMNS',
                `Invalid ACS table-column selection: ${selection.table_id}.${selection.column_id}`,
            );
        }
    }

    const tables = [...new Set(
        selections.map((item) => item.table_id.toLowerCase()),
    )];

    const selectionsSql: string[] = [
        `${quoteIdentifier('t0')}.${quoteIdentifier('geoid')} AS ${quoteIdentifier('geoid')}`,
    ];

    const from = tables.map((table, index) => {
        const alias = `t${index}`;

        for (const selection of selections) {
            if (selection.table_id.toLowerCase() !== table) continue;

            const column = selection.column_id.toLowerCase();
            const output = `${table}_${column}`;

            selectionsSql.push(
                `${quoteIdentifier(alias)}.${quoteIdentifier(column)} AS ${quoteIdentifier(output)}`,
            );
        }

        const tableRef =
            `${quoteIdentifier('acs')}.${quoteIdentifier(table)} AS ${quoteIdentifier(alias)}`;

        if (index === 0) return tableRef;

        return `JOIN ${tableRef}
            ON ${quoteIdentifier('t0')}.${quoteIdentifier('geoid')}
            = ${quoteIdentifier(alias)}.${quoteIdentifier('geoid')}`;
    });

    const result = await query(
        `SELECT ${selectionsSql.join(', ')}
         FROM ${from.join('\n')}
         WHERE ${quoteIdentifier('t0')}.${quoteIdentifier('geoid')} = $1`,
        [normalizedGeoid],
    );

    return result.rows[0] ?? null;
}