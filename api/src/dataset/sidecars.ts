import { FileError } from '../errs/file';
import { getGeocodeFromAddr } from '../utils/census';
import { withSession } from '../utils/storage';
import { appendAcs } from './acsDataset';
import { saveDataset, type Dataset } from './dataset';
import { enrichDataset, GEOCODE_FIELDS, type Geocoder, } from './enrichDataset';
import {
    resolveAddressColumn, ROW, sidecarName, withDeadline, readSidecar,
} from '../utils/fileHelpers';

import { loadDataset, parseFileOptions } from './shared';

export async function geoSidecar(
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

export async function acsSidecar(
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