const API_BASE_URL = '/api';

export class ApiError extends Error {
    constructor(
        public code: string,
        message: string,
        public details?: unknown,
    ) {
        super(message);
    }
}

export type SavedFile = {
    sessionId: string;
    filename: string;
    tempPath: string;
    format: string;
    columnMapping: { id: string; output: string }[];
};

type Preview = { columns: { id: string; label: string }[]; rows: unknown[][] };

export type UploadInfo = { sessionId: string; tempPath: string; filename: string };
export type GeocodeResult = SavedFile & {
    addressField: string;
    counts: { input: number; output: number; matched: number; invalidOrBlank: number; unmatched: number };
    preview: Preview;
};

export type AcsResult = SavedFile & {
    counts: { input: number; uniqueGeoids: number; withAcs: number };
    preview: Preview;
};
export type EnrichResult = SavedFile & {
    counts: { input: number; output: number };
    added: { geocode: string[]; acs: string[] };
};
export type SelectedAcsColumn = { table_id: string; column_id: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const e = data?.error;
        throw new ApiError(
            e?.code ?? 'REQUEST_FAILED',
            (typeof e === 'string' ? e : e?.message) ?? 'Request failed',
            e?.details,
        );
    }
    return data as T;
}

export async function uploadFile(file: File): Promise<UploadInfo> {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${API_BASE_URL}/upload`, { method: 'POST', body });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.sessionId || !data?.tempPath) {
        throw new Error(data?.error || 'File upload failed.');
    }
    return data;
}

export async function fetchAddressFields(u: UploadInfo): Promise<string[]> {
    const q = new URLSearchParams({ path: u.tempPath, sessionId: u.sessionId });
    const res = await fetch(`${API_BASE_URL}/address-fields?${q}`);
    const data: unknown = await res.json();
    if (!res.ok || !Array.isArray(data)) throw new Error('Could not detect potential address fields.');
    return data.filter((f): f is string => typeof f === 'string');
}

export const runGeocode = (u: UploadInfo, addressField: string) =>
    postJson<GeocodeResult>('/files/geocode', {
        sessionId: u.sessionId,
        path: u.tempPath,
        addressField,
    });

export const runAcs = (u: UploadInfo, geocodeFile: string, acsColumns: SelectedAcsColumn[]) =>
    postJson<AcsResult>('/files/acs', {
        sessionId: u.sessionId,
        path: u.tempPath,
        geocodeFile,
        acsColumns,
    });

export const runEnrich = (
    u: UploadInfo,
    opts: {
        geo: boolean;
        acs: boolean;
        geocodeFile?: string;
        acsFile?: string;
        fields?: string[];
        join?: 'left' | 'inner';
	outputName?: string;
    },
) => postJson<EnrichResult>('/files/enrich', { sessionId: u.sessionId, path: u.tempPath, ...opts });

export async function downloadFile(sessionId: string, filename: string) {
    const q = new URLSearchParams({ sessionId, filename });
    const res = await fetch(`${API_BASE_URL}/download-file?${q}`);
    if (!res.ok) throw new Error('The download failed.');

    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}