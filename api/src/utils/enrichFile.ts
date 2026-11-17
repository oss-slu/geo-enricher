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
    type Dataset,
} from './dataset';
import { detectAddressFields } from './addressFields';
import {
    abortError,
    enrichDataset,
    GEOCODE_FIELDS,
    parseEnrichOptions,
    type Geocoder,
} from './enrichDataset';
import { FILE_LIMITS } from './fileLimits';
import { queryACSForGeoid } from './acs';
import {
    baseName, indexSidecar, readSidecar,
    resolveAddressColumn, ROW, sidecarName, uniqueColumn, withDeadline
} from './fileHelpers';
import { appendAcs } from './acsDataset';

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
    geoidField?: string;
    geo?: boolean;
    acs?: boolean;
    geocodeFile?: string;
    acsFile?: string;
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

function parseFileOptions(value: unknown): FileOptions {
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

    for (const key of ['sheet', 'addressField', 'geocodeFile', 'acsFile']) {
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

async function loadDataset(inputPath: string, options: FileOptions) {
    const type = fileType(inputPath);
    const dataset = readDataset(
        await readSessionFile(options.sessionId, inputPath),
        type,
        options,
    );
    return { type, dataset };
}

export async function geocodeStep(
    inputPath: string,
    rawOptions: unknown,
    signal?: AbortSignal,
    geocoder: Geocoder = (address, signal) => getGeocodeFromAddr(address, { signal }),
) {
    const options = parseFileOptions(rawOptions);

    return withDeadline(signal, (sig, check) =>
        withSession(options.sessionId, async () => {
            check();
            const { dataset } = await loadDataset(inputPath, options);
            check();

            const addressId = resolveAddressColumn(dataset, options.addressField);

            const enriched = await enrichDataset(
                dataset,
                addressId,
                { fields: [...GEOCODE_FIELDS], join: 'left' },
                geocoder,
                sig,
            );
            check();

            // Keep only the new columns, relabeled to the raw field names.
            const offset = dataset.columns.length;
            const sidecar: Dataset = {
                columns: [
                    { id: ROW, label: ROW },
                    ...GEOCODE_FIELDS.map((f) => ({ id: f, label: f })),
                ],
                rows: enriched.dataset.rows.map((row, i) => [i, ...row.slice(offset)]),
            };

            const saved = await saveDataset(
                options.sessionId,
                sidecarName(inputPath, 'geocode'),
                sidecar,
                'csv',
                sig,
            );

            return {
                ...saved,
                addressField: addressId,
                counts: enriched.counts,
                // Original columns + geocode columns, first 100 rows, for display.
                preview: {
                    columns: enriched.dataset.columns,
                    rows: enriched.dataset.rows.slice(0, 100),
                },
            };
        }),
    );
}

export async function acsStep(
    inputPath: string,
    rawOptions: unknown,
    signal?: AbortSignal,
) {
    const options = parseFileOptions(rawOptions);

    const acsColumns = options.acsColumns ?? [];

    if (!acsColumns.length) {
        throw new FileError(400, 'INVALID_ACS_COLUMNS', 'acsColumns must be nonempty');
    }

    return withDeadline(signal, (sig, check) =>
        withSession(options.sessionId, async () => {
            check();

            if (!options.geocodeFile) {
                throw new FileError(400, 'INVALID_OPTIONS', 'geocodeFile is required');
            }
            const geo = await readSidecar(options.sessionId, options.geocodeFile);

            // CSV readers may coerce GEOIDs to numbers and drop leading zeros.
            const geoIdx = geo.columns.findIndex((c) => c.label === 'blockGeoid');
            if (geoIdx < 0) {
                throw new FileError(422, 'GEOID_FIELD_NOT_FOUND', 'Geocode file has no blockGeoid');
            }
            geo.columns.push({ id: 'blockGroupGeoid', label: 'blockGroupGeoid' });
            geo.rows = geo.rows.map((row) => {
                const v = row[geoIdx];
                const bg = v === null || v === '' ? null : String(v).padStart(15, '0').slice(0, 12);
                return [...row, bg];

            });

            const result = await appendAcs(geo, 'blockGeoid', acsColumns, check);

            // Keep _row and the appended ACS columns only.
            const keep = [
                0,
                ...result.newColumns.map((_, i) => geo.columns.length + i),
            ];
            const sidecar: Dataset = {
                columns: keep.map((i) => result.dataset.columns[i]),
                rows: result.dataset.rows.map((row) => keep.map((i) => row[i])),
            };

            const saved = await saveDataset(
                options.sessionId,
                sidecarName(inputPath, 'acs'),
                sidecar,
                'csv',
                sig,
            );

            return {
                ...saved,
                counts: result.counts,
                preview: {
                    columns: sidecar.columns.slice(1),
                    rows: sidecar.rows.slice(0, 100).map((r) => r.slice(1)),
                },
            };
        }),
    );
}

export async function enrichFile(
    inputPath: string,
    rawOptions: unknown,
    signal?: AbortSignal,
) {
    const options = parseFileOptions(rawOptions);
    const enrichOpts = parseEnrichOptions(options);

    if (!options.geo && !options.acs) {
        throw new FileError(400, 'NOTHING_SELECTED', 'Select geocode data, ACS data, or both');
    }

    return withDeadline(signal, (sig, check) =>
        withSession(options.sessionId, async () => {
            check();
            const { type, dataset } = await loadDataset(inputPath, options);
            check();

            const columns: Column[] = [...dataset.columns];
            const out: Cell[][] = dataset.rows.map((r) => [...r]);
            let matched: boolean[] | null = null;
            const added = { geo: [] as Column[], acs: [] as Column[] };

            const merge = (
                sc: ReturnType<typeof indexSidecar>,
                pick: string[] | null,
                prefix: string,
                bucket: Column[],
            ) => {
                const picks = sc.columns
                    .map((c, i) => i)
                    .filter((i) => !pick || pick.includes(sc.columns[i].label));

                const newCols = picks.map((i) => uniqueColumn(columns, prefix + sc.columns[i].label));
                columns.push(...newCols);
                bucket.push(...newCols);

                out.forEach((row, r) => {
                    const vals = sc.byRow.get(r);
                    row.push(...picks.map((i) => vals?.[i] ?? null));
                });
            };

            if (options.geo) {
                if (!options.geocodeFile) throw new FileError(400, 'INVALID_OPTIONS', 'geocodeFile is required when geo is true');
                const sc = indexSidecar(await readSidecar(options.sessionId, options.geocodeFile));
                const blockIdx = sc.columns.findIndex((c) => c.label === 'blockGeoid');
                matched = out.map((_, r) => sc.byRow.get(r)?.[blockIdx] != null);
                merge(sc, enrichOpts.fields, 'geocode_', added.geo);
            }

            if (options.acs) {
                if (!options.acsFile) throw new FileError(400, 'INVALID_OPTIONS', 'acsFile is required when acs is true');
                const sc = indexSidecar(await readSidecar(options.sessionId, options.acsFile));
                merge(sc, null, '', added.acs);
            }

            if (columns.length > FILE_LIMITS.columns) {
                throw new FileError(413, 'TABLE_TOO_LARGE', 'Enriched dataset exceeds column limit');
            }
            check();

            // Inner join drops rows the geocoder couldn't match.
            const rows =
                options.geo && enrichOpts.join === 'inner'
                    ? out.filter((_, r) => matched![r])
                    : out;

            const saved = await saveDataset(
                options.sessionId,
                `${baseName(inputPath)}_enriched.${type}`,
                { columns, rows },
                type,
                sig,
            );

            return {
                ...saved,
                counts: { input: dataset.rows.length, output: rows.length },
                added: {
                    geocode: added.geo.map((c) => saved.columnMapping.find((m) => m.id === c.id)?.output ?? c.label),
                    acs: added.acs.map((c) => saved.columnMapping.find((m) => m.id === c.id)?.output ?? c.label),
                },
            };
        }),
    );
}

export async function oldenrichFile(
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
