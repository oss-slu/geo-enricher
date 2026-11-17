import path from 'node:path';
import { FileError } from '../errs/file';
import { FILE_LIMITS } from './fileLimits';
import { abortError } from '../dataset/enrichDataset';
import { detectAddressFields } from './addressFields';
import { readDataset, type Cell, type Column, type Dataset } from '../dataset/dataset';
import { readSessionFile } from './storage';

// The timer / abort / deadline boilerplate from enrichFile, written once.
export async function withDeadline<T>(
    outer: AbortSignal | undefined,
    fn: (signal: AbortSignal, check: () => void) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const expires = Date.now() + FILE_LIMITS.durationMs;

    const deadline = () =>
        controller.abort(
            new FileError(504, 'DEADLINE_EXCEEDED', 'File operation exceeded its deadline'),
        );
    const cancelled = () =>
        controller.abort(
            new FileError(504, 'CANCELLED', 'File operation was cancelled'),
        );

    const timer = setTimeout(deadline, FILE_LIMITS.durationMs);
    if (outer?.aborted) cancelled();
    outer?.addEventListener('abort', cancelled, { once: true });

    const check = () => {
        if (Date.now() >= expires) deadline();
        if (controller.signal.aborted) throw abortError(controller.signal);
    };

    try {
        return await fn(controller.signal, check);
    } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', cancelled);
    }
}

// Find a column by exact id, else by a unique label.
export function resolveColumn(
    dataset: Dataset,
    ref: string,
    code: string,
    message: string,
): string {
    const byId = dataset.columns.find((c) => c.id === ref);
    const matches = byId ? [byId] : dataset.columns.filter((c) => c.label === ref);

    if (matches.length !== 1) throw new FileError(422, code, message);
    return matches[0].id;
}

export function resolveAddressColumn(dataset: Dataset, addressField?: string): string {
    if (addressField !== undefined) {
        return resolveColumn(
            dataset,
            addressField,
            'ADDRESS_FIELD_NOT_FOUND',
            'Select one address column by its unique ID or label',
        );
    }

    const candidates = detectAddressFields(dataset);
    if (candidates.length !== 1) {
        throw new FileError(
            422,
            candidates.length ? 'AMBIGUOUS_ADDRESS_FIELDS' : 'NO_ADDRESS_FIELDS',
            'Specify addressField using one column ID',
            candidates,
        );
    }
    return candidates[0];
}

export const baseName = (p: string) => path.basename(p, path.extname(p));

export const ROW = '_row';

export const sidecarName = (inputPath: string, kind: 'geocode' | 'acs') =>
    `${kind}_${baseName(inputPath)}.csv`;

export async function readSidecar(sessionId: string, filePath: string): Promise<Dataset> {
    const buf = await readSessionFile(sessionId, filePath);
    const ds = readDataset(buf, 'csv', { hasHeaders: true });
    if (ds.columns[0]?.label !== ROW) {
        throw new FileError(422, 'INVALID_SIDECAR', 'Sidecar file is malformed');
    }
    return ds;
}

// Index sidecar rows by original row number, dropping the _row column.
export function indexSidecar(ds: Dataset) {
    const byRow = new Map<number, Cell[]>();
    for (const row of ds.rows) {
        const n = Number(row[0]);
        if (Number.isInteger(n)) byRow.set(n, row.slice(1));
    }
    return { columns: ds.columns.slice(1), byRow };
}

export function uniqueColumn(existing: Column[], label: string): Column {
    const labels = new Set(existing.map((c) => c.label));
    const ids = new Set(existing.map((c) => c.id));

    let l = label;
    for (let n = 2; labels.has(l); n++) l = `${label}_${n}`;

    let id = l;
    for (let n = 2; ids.has(id); n++) id = `${l}_${n}`;

    return { id, label: l };
}

