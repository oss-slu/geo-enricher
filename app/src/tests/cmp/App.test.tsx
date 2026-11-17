import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../cmp/App';

const upload = {
    success: true,
    sessionId: 'session',
    filename: 'input.csv',
    tempPath: '/tmp/session/input.csv',
};
const saved = { sessionId: 'session', format: 'csv', columnMapping: [] };
const geocode = {
    ...saved,
    filename: 'geocode_input.csv',
    tempPath: '/tmp/session/geocode_input.csv',
    addressField: 'field1',
    counts: { input: 2, output: 2, matched: 1, unmatched: 1, invalidOrBlank: 0 },
    preview: {
        columns: [
            { id: 'field1', label: 'address' },
            { id: 'geocode_blockGeoid', label: 'geocode_blockGeoid' },
        ],
        rows: [
            ['123 Main St, St Louis, MO 63103', '291895001001'],
            ['456 Oak St, St Louis, MO 63103', null],
        ],
    },
};
const acs = {
    ...saved,
    filename: 'acs_input.csv',
    tempPath: '/tmp/session/acs_input.csv',
    counts: { input: 2, uniqueGeoids: 1, withAcs: 1 },
    preview: {
        columns: [{ id: 'acs', label: 'B02001 B02001001' }],
        rows: [[4321], [null]],
    },
};
const enriched = {
    ...saved,
    filename: 'enriched_input.csv',
    tempPath: '/tmp/session/enriched_input.csv',
    counts: { input: 2, output: 2 },
    added: { geocode: ['blockGeoid'], acs: ['B02001 B02001001'] },
};
const metadata = [
    { table_id: 'B02001', table_title: 'Race', column_id: 'B02001001', column_title: 'Total:' },
];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

let geocodeResponse: () => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    geocodeResponse = async () => json(geocode);
    fetchMock = vi.fn(async (input: string) => {
        const path = new URL(input, 'http://x').pathname;
        switch (path) {
            case '/api/acs-metadata':
                return json({ ok: true, data: metadata });
            case '/api/upload':
                return json(upload);
            case '/api/address-fields':
                return json(['address']);
            case '/api/files/geocode':
                return geocodeResponse();
            case '/api/files/acs':
                return json(acs);
            case '/api/files/enrich':
                return json(enriched);
            case '/api/download-file':
                return new Response('address\n');
        }
        throw new Error(`Unexpected fetch ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:url');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const calls = (path: string) =>
    fetchMock.mock.calls.filter(([url]) => new URL(url, 'http://x').pathname === path);

async function uploadFile() {
    const file = new File(['address\n"123 Main St, St Louis, MO 63103"\n'], 'input.csv', {
        type: 'text/csv',
    });
    fireEvent.change(screen.getByLabelText('Upload a CSV or Excel file...'), {
        target: { files: [file] },
    });
    expect(await screen.findByLabelText(/Potential address field/)).toHaveValue('address');
}

describe('App', () => {
    it('hides the file steps until a file is uploaded', () => {
        render(<App />);
        expect(screen.queryByRole('button', { name: 'Geocode addresses' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Enrich and download' })).toBeNull();
    });

    it('runs upload → geocode → ACS → enrich and download', async () => {
        render(<App />);
        await uploadFile();

        const fetchAcs = screen.getByRole('button', { name: 'Fetch ACS data' });
        const enrich = screen.getByRole('button', { name: 'Enrich and download' });
        expect(fetchAcs).toBeDisabled();
        expect(enrich).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Geocode addresses' }));
        expect(
            await screen.findByText('1 matched, 1 unmatched, 0 invalid or blank'),
        ).toBeInTheDocument();
        expect(screen.getByText('291895001001')).toBeInTheDocument();
        expect(enrich).toBeEnabled();

        // ACS needs a column selection too.
        expect(fetchAcs).toBeDisabled();
        fireEvent.click(await screen.findByRole('checkbox', { name: /B02001001/ }));
        expect(fetchAcs).toBeEnabled();

        fireEvent.click(fetchAcs);
        expect(await screen.findByText('1 of 2 rows have ACS data')).toBeInTheDocument();
        expect(screen.getByText('4321')).toBeInTheDocument();
        expect(JSON.parse(calls('/api/files/acs')[0][1].body)).toMatchObject({
            geocodeFile: geocode.tempPath,
            acsColumns: [{ table_id: 'B02001', column_id: 'B02001001' }],
        });

        fireEvent.click(enrich);
        await waitFor(() => expect(calls('/api/download-file')).toHaveLength(1));
        expect(JSON.parse(calls('/api/files/enrich')[0][1].body)).toMatchObject({
            geo: true,
            acs: true,
            geocodeFile: geocode.tempPath,
            acsFile: acs.tempPath,
        });
    });

    it('warns when the ACS selection changes after a fetch', async () => {
        render(<App />);
        await uploadFile();
        fireEvent.click(screen.getByRole('button', { name: 'Geocode addresses' }));
        await screen.findByText(/1 matched/);
        const column = await screen.findByRole('checkbox', { name: /B02001001/ });
        fireEvent.click(column);
        fireEvent.click(screen.getByRole('button', { name: 'Fetch ACS data' }));
        await screen.findByText(/rows have ACS data/);

        fireEvent.click(column);
        expect(screen.getByText(/ACS selection changed/)).toBeInTheDocument();
        expect(screen.getByLabelText('ACS data')).toBeDisabled();
    });

    it('shows API errors', async () => {
        geocodeResponse = async () =>
            json({ error: { code: 'NO_ADDRESS_FIELDS', message: 'No address column' } }, 422);
        render(<App />);
        await uploadFile();
        fireEvent.click(screen.getByRole('button', { name: 'Geocode addresses' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No address column');
    });

    it('locks every control while a step is running', async () => {
        let finish!: (r: Response) => void;
        geocodeResponse = () => new Promise((resolve) => (finish = resolve));
        render(<App />);
        await uploadFile();

        fireEvent.click(screen.getByRole('button', { name: 'Geocode addresses' }));
        expect(await screen.findByRole('button', { name: 'Geocoding…' })).toBeDisabled();
        expect(screen.getByLabelText(/Potential address field/)).toBeDisabled();
        expect(screen.getByLabelText('Upload a CSV or Excel file...')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Enrich and download' })).toBeDisabled();

        await act(async () => finish(json(geocode)));
        expect(await screen.findByRole('button', { name: 'Geocode addresses' })).toBeEnabled();
        expect(screen.getByLabelText('Upload a CSV or Excel file...')).toBeEnabled();
    });
});
