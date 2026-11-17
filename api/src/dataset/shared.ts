
import { FileError } from '../errs/file';
import { readSessionFile, validateSessionId } from '../utils/storage';
import type { SelectedAcsColumn } from '../utils/acs';
import {
    fileType,
    readDataset,
    type ReadOptions,
    type Cell,
} from './dataset';

import {
    parseEnrichOptions,
} from './enrichDataset';

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

export function isDatasetCell(value: unknown): value is Cell {
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

export async function loadDataset(inputPath: string, options: FileOptions) {
    const type = fileType(inputPath);
    const dataset = readDataset(
        await readSessionFile(options.sessionId, inputPath),
        type,
        options,
    );
    return { type, dataset };
}