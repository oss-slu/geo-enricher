import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ApiError,
    downloadFile,
    fetchAddressFields,
    runAcs,
    runEnrich,
    runGeocode,
    uploadFile,
    type UploadInfo,
} from '../../api/files';

const upload: UploadInfo = {
    sessionId: 'session',
    tempPath: '/tmp/session/input.csv',
    filename: 'input.csv',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

function mockFetch(response: Response) {
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    return fetch;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('uploadFile', () => {
    const file = new File(['a,b\n1,2\n'], 'input.csv');

    it('posts the file as form data', async () => {
        const fetch = mockFetch(json(upload));
        await expect(uploadFile(file)).resolves.toEqual(upload);
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('/api/upload');
        expect(init.method).toBe('POST');
        expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    });

    it('uses the server error message', async () => {
        mockFetch(json({ error: 'No valid file uploaded' }, 400));
        await expect(uploadFile(file)).rejects.toThrow('No valid file uploaded');
    });

    it.each([
        ['an OK response without session info', json({ success: true })],
        ['a non-JSON error', new Response('oops', { status: 500 })],
    ])('rejects %s', async (_, response) => {
        mockFetch(response);
        await expect(uploadFile(file)).rejects.toThrow('File upload failed.');
    });
});

describe('fetchAddressFields', () => {
    it('queries by session and path, keeping only strings', async () => {
        const fetch = mockFetch(json(['address', 1, null, 'street']));
        await expect(fetchAddressFields(upload)).resolves.toEqual(['address', 'street']);
        const url = new URL(fetch.mock.calls[0][0], 'http://x');
        expect(url.pathname).toBe('/api/address-fields');
        expect(url.searchParams.get('path')).toBe(upload.tempPath);
        expect(url.searchParams.get('sessionId')).toBe('session');
    });

    it.each([
        ['an error status', json(['address'], 500)],
        ['a non-array body', json({ fields: [] })],
    ])('rejects %s', async (_, response) => {
        mockFetch(response);
        await expect(fetchAddressFields(upload)).rejects.toThrow(
            'Could not detect potential address fields.',
        );
    });
});

describe('file steps', () => {
    const acsColumns = [{ table_id: 'b01001', column_id: 'b01001001' }];

    it.each([
        [
            'runGeocode',
            () => runGeocode(upload, 'address'),
            '/api/files/geocode',
            { addressField: 'address' },
        ],
        [
            'runAcs',
            () => runAcs(upload, '/tmp/session/geocode_input.csv', acsColumns),
            '/api/files/acs',
            { geocodeFile: '/tmp/session/geocode_input.csv', acsColumns },
        ],
        [
            'runEnrich',
            () => runEnrich(upload, { geo: true, acs: false, geocodeFile: 'g.csv', join: 'inner' }),
            '/api/files/enrich',
            { geo: true, acs: false, geocodeFile: 'g.csv', join: 'inner' },
        ],
    ])('%s posts JSON options for the upload', async (_, call, path, extra) => {
        const fetch = mockFetch(json({ ok: 1 }));
        await expect(call()).resolves.toEqual({ ok: 1 });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(path);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(JSON.parse(init.body)).toEqual({
            sessionId: 'session',
            path: upload.tempPath,
            ...extra,
        });
    });

    it('turns structured API errors into ApiError', async () => {
        mockFetch(
            json(
                { error: { code: 'ADDRESS_FIELD_NOT_FOUND', message: 'Pick one', details: ['a', 'b'] } },
                422,
            ),
        );
        const err = await runGeocode(upload, 'x').catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err).toMatchObject({
            code: 'ADDRESS_FIELD_NOT_FOUND',
            message: 'Pick one',
            details: ['a', 'b'],
        });
    });

    it('accepts plain-string errors', async () => {
        mockFetch(json({ error: 'Too many file operations' }, 429));
        await expect(runGeocode(upload, 'x')).rejects.toMatchObject({
            code: 'REQUEST_FAILED',
            message: 'Too many file operations',
        });
    });

    it.each([
        ['a non-JSON body', new Response('<html>', { status: 502 })],
        ['an error without a message', json({ error: { code: 'X' } }, 500)],
    ])('falls back to a generic message for %s', async (_, response) => {
        mockFetch(response);
        await expect(runGeocode(upload, 'x')).rejects.toThrow('Request failed');
    });
});

describe('downloadFile', () => {
    it('downloads the blob through a temporary link', async () => {
        const fetch = mockFetch(new Response('a,b\n'));
        const createObjectURL = vi.fn(() => 'blob:url');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            expect(this.href).toBe('blob:url');
            expect(this.download).toBe('out.csv');
            expect(document.body.contains(this)).toBe(true);
        });

        await downloadFile('session', 'out.csv');

        const url = new URL(fetch.mock.calls[0][0], 'http://x');
        expect(url.pathname).toBe('/api/download-file');
        expect(url.searchParams.get('filename')).toBe('out.csv');
        expect(click).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:url');
        expect(document.querySelector('a[download]')).toBeNull();
    });

    it('rejects failed downloads', async () => {
        mockFetch(new Response('', { status: 404 }));
        await expect(downloadFile('session', 'out.csv')).rejects.toThrow('The download failed.');
    });
});
