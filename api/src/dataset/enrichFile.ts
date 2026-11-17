import { FileError } from '../errs/file';
import { withSession } from '../utils/storage';
import {
    saveDataset,
    type Cell,
    type Column,
} from './dataset';
import { parseEnrichOptions } from './enrichDataset';
import { FILE_LIMITS } from '../utils/fileLimits';
import {
    baseName, indexSidecar, readSidecar,
    uniqueColumn, withDeadline
} from '../utils/fileHelpers';
import { loadDataset, parseFileOptions } from './shared';

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
                    .map((_, i) => i)
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
                merge(sc, enrichOpts.fields, '', added.geo);
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
                `enriched_${baseName(inputPath)}.${type}`,
                { columns, rows },
                type,
                sig,
                {overwrite: true},
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