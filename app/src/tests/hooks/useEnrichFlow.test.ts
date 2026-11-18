import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api/files';
import { useEnrichFlow } from '../../hooks/useEnrichFlow';

vi.mock('../../api/files', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../api/files')>()),
    uploadFile: vi.fn(),
    fetchAddressFields: vi.fn(),
    runGeocode: vi.fn(),
    runAcs: vi.fn(),
    runEnrich: vi.fn(),
    downloadFile: vi.fn(),
}));

const mocked = vi.mocked(api);

const upload: api.UploadInfo = {
    sessionId: 'session',
    tempPath: '/tmp/session/input.csv',
    filename: 'input.csv',
};
const saved = { sessionId: 'session', format: 'csv', columnMapping: [] };
const preview = { columns: [{ id: 'a', label: 'a' }], rows: [['1']] };
const geocode = (tempPath = '/tmp/session/geocode_input.csv'): api.GeocodeResult => ({
    ...saved,
    filename: 'geocode_input.csv',
    tempPath,
    addressField: 'field1',
    counts: { input: 1, output: 1, matched: 1, unmatched: 0, invalidOrBlank: 0 },
    preview,
});
const acs: api.AcsResult = {
    ...saved,
    filename: 'acs_input.csv',
    tempPath: '/tmp/session/acs_input.csv',
    counts: { input: 1, uniqueGeoids: 1, withAcs: 1 },
    preview,
};
const enriched: api.EnrichResult = {
    ...saved,
    filename: 'enriched_input.csv',
    tempPath: '/tmp/session/enriched_input.csv',
    counts: { input: 1, output: 1 },
    added: { geocode: ['latitude'], acs: [] },
};
const columns: api.SelectedAcsColumn[] = [{ table_id: 'b01001', column_id: 'b01001001' }];

const csv = (name = 'input.csv') =>
    new File(['address,name\n"123 Main St, St Louis, MO 63103",A\n'], name, {
        type: 'text/csv',
    });

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

function setup(selected = columns) {
    return renderHook(({ selected }) => useEnrichFlow(selected), {
        initialProps: { selected },
    });
}

// Upload a file and run any requested steps.
async function ready(steps: ('geocode' | 'acs')[] = [], selected = columns) {
    const hook = setup(selected);
    await act(() => hook.result.current.chooseFile(csv()));
    if (steps.includes('geocode')) await act(() => hook.result.current.geocodeStep());
    if (steps.includes('acs')) await act(() => hook.result.current.acsStep());
    return hook;
}

beforeEach(() => {
    vi.resetAllMocks();
    mocked.uploadFile.mockResolvedValue(upload);
    mocked.fetchAddressFields.mockResolvedValue(['address', 'other']);
    mocked.runGeocode.mockResolvedValue(geocode());
    mocked.runAcs.mockResolvedValue(acs);
    mocked.runEnrich.mockResolvedValue(enriched);
    mocked.downloadFile.mockResolvedValue(undefined);
});

describe('chooseFile', () => {
    it('previews, uploads and picks the first detected address field', async () => {
        const { result } = await ready();
        expect(result.current.fileName).toBe('input.csv');
        expect(result.current.preview?.headers).toEqual(['address', 'name']);
        expect(result.current.upload).toEqual(upload);
        expect(result.current.addressFields).toEqual(['address', 'other']);
        expect(result.current.addressField).toBe('address');
        expect(result.current.busy).toBeNull();
        expect(result.current.error).toBe('');
    });

    it('rejects unsupported file types without uploading', async () => {
        const { result } = setup();
        await act(() => result.current.chooseFile(csv('notes.txt')));
        expect(result.current.error).toMatch(/CSV or Excel/);
        expect(mocked.uploadFile).not.toHaveBeenCalled();
    });

    it('resets earlier results when a new file is chosen', async () => {
        const { result } = await ready(['geocode', 'acs']);
        mocked.uploadFile.mockRejectedValue(new Error('File upload failed.'));
        await act(() => result.current.chooseFile(csv('second.csv')));
        expect(result.current.fileName).toBe('second.csv');
        expect(result.current.upload).toBeNull();
        expect(result.current.geocode).toBeNull();
        expect(result.current.acs).toBeNull();
        expect(result.current.addressFields).toEqual([]);
        expect(result.current.error).toBe('File upload failed.');
    });

    it('leaves the address field empty when none are detected', async () => {
        mocked.fetchAddressFields.mockResolvedValue([]);
        const { result } = await ready();
        expect(result.current.addressField).toBe('');
    });
});

describe('step guards', () => {
    it('requires an upload before geocoding or enriching', async () => {
        const { result } = setup();
        await act(() => result.current.geocodeStep());
        expect(result.current.error).toBe('Select an address field first.');
        await act(() => result.current.enrichStep({ geo: true, acs: false }));
        expect(result.current.error).toBe('Upload a file first.');
        expect(mocked.runGeocode).not.toHaveBeenCalled();
        expect(mocked.runEnrich).not.toHaveBeenCalled();
    });

    it('requires geocoding and a column selection before ACS', async () => {
        const { result } = await ready([], []);
        await act(() => result.current.acsStep());
        expect(result.current.error).toBe('Run the geocoder first.');
        await act(() => result.current.geocodeStep());
        await act(() => result.current.acsStep());
        expect(result.current.error).toBe('Select at least one ACS column.');
        expect(mocked.runAcs).not.toHaveBeenCalled();
    });

    it('reports API errors and clears them on the next action', async () => {
        const { result } = await ready();
        mocked.runGeocode.mockRejectedValueOnce(new api.ApiError('X', 'Geocoder is down'));
        await act(() => result.current.geocodeStep());
        expect(result.current.error).toBe('Geocoder is down');
        await act(() => result.current.geocodeStep());
        expect(result.current.error).toBe('');
    });

    it('uses a generic message for non-Error failures', async () => {
        const { result } = await ready();
        mocked.runGeocode.mockRejectedValueOnce('boom');
        await act(() => result.current.geocodeStep());
        expect(result.current.error).toBe('An unexpected error occurred.');
    });
});

describe('steps', () => {
    it('geocodes with the selected address field', async () => {
        const { result } = await ready();
        act(() => result.current.setAddressField('other'));
        await act(() => result.current.geocodeStep());
        expect(mocked.runGeocode).toHaveBeenCalledWith(upload, 'other');
        expect(result.current.geocode).toEqual(geocode());
    });

    it('fetches ACS from the geocode sidecar', async () => {
        const { result } = await ready(['geocode', 'acs']);
        expect(mocked.runAcs).toHaveBeenCalledWith(upload, geocode().tempPath, columns);
        expect(result.current.acs).toEqual(acs);
    });

    it('clears downstream results when geocoding again', async () => {
        const { result } = await ready(['geocode', 'acs']);
        await act(() => result.current.enrichStep({ geo: true, acs: true }));
        expect(result.current.enriched).toEqual(enriched);
        await act(() => result.current.geocodeStep());
        expect(result.current.acs).toBeNull();
        expect(result.current.enriched).toBeNull();
    });

    it('clears the enriched result when fetching ACS again', async () => {
        const { result } = await ready(['geocode', 'acs']);
        await act(() => result.current.enrichStep({ geo: true, acs: true }));
        await act(() => result.current.acsStep());
        expect(result.current.enriched).toBeNull();
    });

    it.each([
        [{ geo: true, acs: true }, { geocodeFile: geocode().tempPath, acsFile: acs.tempPath }],
        [{ geo: true, acs: false }, { geocodeFile: geocode().tempPath }],
        [{ geo: false, acs: true }, { acsFile: acs.tempPath }],
    ])('enriches %o with only the matching sidecars, then downloads', async (opts, files) => {
        const { result } = await ready(['geocode', 'acs']);
        await act(() => result.current.enrichStep(opts));
        expect(mocked.runEnrich).toHaveBeenCalledWith(upload, { ...opts, ...files });
        expect(mocked.downloadFile).toHaveBeenCalledWith('session', 'enriched_input.csv');
    });

    it('reports download failures but keeps the enriched result', async () => {
        const { result } = await ready(['geocode']);
        mocked.downloadFile.mockRejectedValueOnce(new Error('The download failed.'));
        await act(() => result.current.enrichStep({ geo: true, acs: false }));
        expect(result.current.enriched).toEqual(enriched);
        expect(result.current.error).toBe('The download failed.');
    });

    it('sets busy for the running step', async () => {
        const { result } = await ready();
        const pending = deferred<api.GeocodeResult>();
        mocked.runGeocode.mockReturnValueOnce(pending.promise);
        let done!: Promise<void>;
        act(() => {
            done = result.current.geocodeStep();
        });
        expect(result.current.busy).toBe('geocode');
        await act(async () => {
            pending.resolve(geocode());
            await done;
        });
        expect(result.current.busy).toBeNull();
    });
});

describe('stale results', () => {
    it('marks ACS stale when the column selection changes, until refetched', async () => {
        const hook = await ready(['geocode', 'acs']);
        expect(hook.result.current.acsStale).toBe(false);

        const more = [...columns, { table_id: 'b02001', column_id: 'b02001001' }];
        hook.rerender({ selected: more });
        expect(hook.result.current.acsStale).toBe(true);

        await act(() => hook.result.current.acsStep());
        expect(hook.result.current.acsStale).toBe(false);
        expect(mocked.runAcs).toHaveBeenLastCalledWith(upload, geocode().tempPath, more);
    });

    it('clears geocode, ACS and enriched results when the address field changes', async () => {
        const { result } = await ready(['geocode', 'acs']);
        await act(() => result.current.enrichStep({ geo: true, acs: true }));

        act(() => result.current.setAddressField('other'));
        expect(result.current.addressField).toBe('other');
        expect(result.current.geocode).toBeNull();
        expect(result.current.acs).toBeNull();
        expect(result.current.enriched).toBeNull();
    });

    it('keeps results when the same address field is reselected', async () => {
        const { result } = await ready(['geocode']);
        act(() => result.current.setAddressField('address'));
        expect(result.current.geocode).toEqual(geocode());
    });
});

describe('one action at a time', () => {
    it('ignores a geocode started while ACS is fetching', async () => {
        const { result } = await ready(['geocode']);
        const pending = deferred<api.AcsResult>();
        mocked.runAcs.mockReturnValueOnce(pending.promise);

        let fetching!: Promise<void>;
        act(() => {
            fetching = result.current.acsStep();
        });
        await act(() => result.current.geocodeStep());
        expect(mocked.runGeocode).toHaveBeenCalledTimes(1);
        expect(result.current.busy).toBe('acs');

        await act(async () => {
            pending.resolve(acs);
            await fetching;
        });
        expect(result.current.acs).toEqual(acs);
        expect(result.current.busy).toBeNull();
    });

    it('refuses two actions started in the same tick', async () => {
        const { result } = await ready();
        await act(async () => {
            await Promise.all([result.current.geocodeStep(), result.current.geocodeStep()]);
        });
        expect(mocked.runGeocode).toHaveBeenCalledTimes(1);
    });

    it('ignores a new file chosen while a step is running', async () => {
        const { result } = await ready();
        const pending = deferred<api.GeocodeResult>();
        mocked.runGeocode.mockReturnValueOnce(pending.promise);

        let geocoding!: Promise<void>;
        act(() => {
            geocoding = result.current.geocodeStep();
        });
        await act(() => result.current.chooseFile(csv('second.csv')));
        expect(mocked.uploadFile).toHaveBeenCalledTimes(1);
        expect(result.current.fileName).toBe('input.csv');

        await act(async () => {
            pending.resolve(geocode());
            await geocoding;
        });
        expect(result.current.geocode).toEqual(geocode());
    });

    it('ignores address field changes while a step is running', async () => {
        const { result } = await ready();
        const pending = deferred<api.GeocodeResult>();
        mocked.runGeocode.mockReturnValueOnce(pending.promise);

        let geocoding!: Promise<void>;
        act(() => {
            geocoding = result.current.geocodeStep();
        });
        act(() => result.current.setAddressField('other'));
        await act(async () => {
            pending.resolve(geocode());
            await geocoding;
        });
        expect(result.current.addressField).toBe('address');
        expect(result.current.geocode).toEqual(geocode());
    });
});

describe('chooseAddress', () => {
    const typed = '123 Main St, St Louis, MO 63103';

    it('uploads the address as a one-row CSV and runs the normal steps', async () => {
        const { result } = setup();
        await act(() => result.current.chooseAddress(`  ${typed} `));

        const file = mocked.uploadFile.mock.calls[0][0];
        expect(file.name).toBe('address.csv');
        expect(await file.text()).toBe(`address\n"${typed}"\n`);
        expect(result.current.preview).toEqual({ headers: ['address'], rows: [[typed]] });

        await act(() => result.current.geocodeStep());
        await act(() => result.current.acsStep());
        expect(mocked.runGeocode).toHaveBeenCalledWith(upload, 'address');
        expect(mocked.runAcs).toHaveBeenCalledWith(upload, geocode().tempPath, columns);
    });

    it('escapes quotes in the address', async () => {
        const { result } = setup();
        await act(() => result.current.chooseAddress('1 "A" St, St Louis, MO 63103'));
        const file = mocked.uploadFile.mock.calls[0][0];
        expect(await file.text()).toBe('address\n"1 ""A"" St, St Louis, MO 63103"\n');
    });

    it('ignores a blank address', async () => {
        const { result } = setup();
        await act(() => result.current.chooseAddress('   '));
        expect(mocked.uploadFile).not.toHaveBeenCalled();
    });

    it('is replaced by a file uploaded afterwards', async () => {
        const { result } = setup();
        await act(() => result.current.chooseAddress(typed));
        await act(() => result.current.geocodeStep());
        await act(() => result.current.chooseFile(csv()));
        expect(result.current.fileName).toBe('input.csv');
        expect(result.current.geocode).toBeNull();
        await act(() => result.current.geocodeStep());
        expect(result.current.geocode).toEqual(geocode());
        expect(mocked.runGeocode).toHaveBeenCalledTimes(2);
    });
});
