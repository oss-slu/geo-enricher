
import path from 'node:path';
import { FileError } from '../errs/file';
import { getGeocodeFromAddr } from './census';
import { readSessionFile, validateSessionId, withSession } from './storage';
import {
    fileType,
    readDataset,
    saveDataset,
    type ReadOptions,
    type Cell,
    type Column,
} from './dataset';
import { detectAddressFields } from './addressFields';
import {
    abortError,
    enrichDataset,
    parseEnrichOptions,
    type Geocoder,
} from './enrichDataset';
import { FILE_LIMITS } from './fileLimits';
import { queryACSForGeoid } from './acs';

export type SelectedAcsColumn = {
    table_id: string;
    column_id: string;
};

export type FileOptions = ReadOptions & {
    sessionId: string;
    addressField?: string;
    fields?: unknown;
    join?: unknown;
    acsColumns?: SelectedAcsColumn[];
};

function isDatasetCell(value: unknown): value is Cell {
    return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
    );
}

export function parseFileOptions(value: unknown): FileOptions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new FileError(
            400,
            'INVALID_OPTIONS',
            'A JSON options object is required',
        );
    }

    const body = value as Record<string, unknown>;

    validateSessionId(body.sessionId as string);
    parseEnrichOptions(body);

    if (
        body.hasHeaders !== undefined &&
        typeof body.hasHeaders !== 'boolean'
    ) {
        throw new FileError(
            400,
            'INVALID_HEADERS',
            'hasHeaders must be a boolean',
        );
    }

    for (const key of ['sheet', 'addressField']) {
        if (
            body[key] !== undefined &&
            (typeof body[key] !== 'string' || !body[key])
        ) {
            throw new FileError(
                400,
                'INVALID_OPTIONS',
                `${key} must be a nonempty string`,
            );
        }
    }

    if (body.acsColumns !== undefined) {
        if (!Array.isArray(body.acsColumns)) {
            throw new FileError(
                400,
                'INVALID_ACS_COLUMNS',
                'acsColumns must be an array',
            );
        }

        const seen = new Set<string>();

        for (const selection of body.acsColumns) {
            if (
                !selection ||
                typeof selection !== 'object' ||
                typeof selection.table_id !== 'string' ||
                !selection.table_id.trim() ||
                typeof selection.column_id !== 'string' ||
                !selection.column_id.trim()
            ) {
                throw new FileError(
                    400,
                    'INVALID_ACS_COLUMNS',
                    'Each ACS selection requires a table_id and column_id',
                );
            }

            const key =
                `${selection.table_id.toLowerCase()}:${selection.column_id.toLowerCase()}`;

            if (seen.has(key)) {
                throw new FileError(
                    400,
                    'INVALID_ACS_COLUMNS',
                    'Duplicate ACS column selections are not allowed',
                );
            }

            seen.add(key);
        }
    }

    return body as FileOptions;
}

export async function enrichFile(
    inputPath: string,
    rawOptions: unknown,
    signal?: AbortSignal,
    geocoder: Geocoder = (address, signal) =>
        getGeocodeFromAddr(address, { signal }),
) {
    const options = parseFileOptions(rawOptions);
    const controller = new AbortController();
    const expires = Date.now() + FILE_LIMITS.durationMs;

    const deadline = () =>
        controller.abort(
            new FileError(
                504,
                'DEADLINE_EXCEEDED',
                'File enrichment exceeded its deadline',
            ),
        );

    const timer = setTimeout(deadline, FILE_LIMITS.durationMs);

    const cancelled = () =>
        controller.abort(
            new FileError(
                504,
                'CANCELLED',
                'File enrichment was cancelled',
            ),
        );

    if (signal?.aborted) cancelled();
    signal?.addEventListener('abort', cancelled, { once: true });

    const check = () => {
        if (Date.now() >= expires) deadline();

        if (controller.signal.aborted) {
            throw abortError(controller.signal);
        }
    };

    try {
        return await withSession(options.sessionId, async () => {
            check();

            const type = fileType(inputPath);
            const dataset = readDataset(
                await readSessionFile(options.sessionId, inputPath),
                type,
                options,
            );

            check();

            let addressId: string;

            if (options.addressField !== undefined) {
                const idMatch = dataset.columns.find(
                    (col) => col.id === options.addressField,
                );

                const columns = idMatch
                    ? [idMatch]
                    : dataset.columns.filter(
                          (col) => col.label === options.addressField,
                      );

                if (columns.length !== 1) {
                    throw new FileError(
                        422,
                        'ADDRESS_FIELD_NOT_FOUND',
                        'Select one address column by its unique ID or label',
                    );
                }

                addressId = columns[0].id;
            } else {
                const candidates = detectAddressFields(dataset);

                if (candidates.length !== 1) {
                    throw new FileError(
                        422,
                        candidates.length
                            ? 'AMBIGUOUS_ADDRESS_FIELDS'
                            : 'NO_ADDRESS_FIELDS',
                        'Specify addressField using one column ID',
                        candidates,
                    );
                }

                addressId = candidates[0];
            }

            const enriched = await enrichDataset(
                dataset,
                addressId,
                parseEnrichOptions(options),
                geocoder,
                controller.signal,
            );

            check();

            const acsColumns = options.acsColumns ?? [];

            if (acsColumns.length > 0) {
                if (
                    enriched.dataset.columns.length + acsColumns.length >
                    FILE_LIMITS.columns
                ) {
                    throw new FileError(
                        413,
                        'TABLE_TOO_LARGE',
                        'Enriched dataset exceeds column limit',
                    );
                }

                const acsRows = await Promise.all(
                    enriched.geoids.map(async (geoid) => {
                        check();

                        if (!geoid) {
                            return null;
                        }

                        return queryACSForGeoid(geoid, acsColumns);
                    }),
                );

                check();

                const acsColumnDefinitions: Column[] = acsColumns.map(
                    (selection) => ({
                        id: `acs_${selection.table_id.toLowerCase()}_${selection.column_id.toLowerCase()}`,
                        label: `${selection.table_id.toUpperCase()} ${selection.column_id.toUpperCase()}`,
                    }),
                );

                enriched.dataset.columns.push(...acsColumnDefinitions);

                enriched.dataset.rows = enriched.dataset.rows.map(
                    (row, index) => {
                        const acsRow = acsRows[index];

                        const values: Cell[] = acsColumns.map((selection) => {
                            if (!acsRow) return null;

                            const key =
                                `${selection.table_id.toLowerCase()}_${selection.column_id.toLowerCase()}`;

                            const value = acsRow[key];

                            return isDatasetCell(value) ? value : null;
                        });

                        return [...row, ...values];
                    },
                );
            }

            check();

            const suffix =
                acsColumns.length > 0 ? '_enriched' : '_geocoded';

            const saved = await saveDataset(
                options.sessionId,
                `${path.basename(inputPath, path.extname(inputPath))}${suffix}.${type}`,
                enriched.dataset,
                type,
                controller.signal,
            );

            return {
                ...saved,
                addressField: addressId,
                geocodeMapping: enriched.geocodeMapping.map((col) => ({
                    ...col,
                    output: saved.columnMapping.find(
                        (mapping) => mapping.id === col.id,
                    )!.output,
                })),
                acsMapping: acsColumns.map((selection, index) => ({
                    ...selection,
                    id: `acs_${selection.table_id.toLowerCase()}_${selection.column_id.toLowerCase()}`,
                    output: saved.columnMapping.find(
                        (mapping) =>
                            mapping.id ===
                            `acs_${selection.table_id.toLowerCase()}_${selection.column_id.toLowerCase()}`,
                    )?.output ?? acsColumnDefinitionsFallback(selection),
                })),
                counts: enriched.counts,
            };
        });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancelled);
    }
}

function acsColumnDefinitionsFallback(selection: SelectedAcsColumn): string {
    return `${selection.table_id.toUpperCase()} ${selection.column_id.toUpperCase()}`;
}
