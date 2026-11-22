
import { useRef, useState } from 'react';
import * as api from '../api/files';
import { parsePreview } from '../utils/parsePreview';
import type { PreviewData } from '../cmp/PreviewTable';

export type Step = 'upload' | 'geocode' | 'acs' | 'enrich';

export function useEnrichFlow(selectedAcsColumns: api.SelectedAcsColumn[]) {
    const [upload, setUpload] = useState<api.UploadInfo | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [addressFields, setAddressFields] = useState<string[]>([]);
    const [addressField, setAddressField] = useState('');

    const [geocode, setGeocode] = useState<api.GeocodeResult | null>(null);
    const [acs, setAcs] = useState<api.AcsResult | null>(null);
    const [acsUsed, setAcsUsed] = useState<api.SelectedAcsColumn[]>([]);
    const [enriched, setEnriched] = useState<api.EnrichResult | null>(null);

    const [busy, setBusy] = useState<Step | null>(null);
    const [error, setError] = useState('');

    // Synchronous mirror of busy, so a second action in the same tick is also refused.
    const busyRef = useRef<Step | null>(null);

    // Wraps every action: sets busy, clears the error, and reports failures.
    // Only one action runs at a time; a slower one could otherwise overwrite
    // results from an action that started after it. Resolves to fn's result,
    // or undefined if the action was refused or failed.
    async function run<T>(
        step: Step,
        fn: () => Promise<T>,
    ): Promise<T | undefined> {
        if (busyRef.current) return;

        busyRef.current = step;
        setBusy(step);
        setError('');

        try {
            return await fn();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'An unexpected error occurred.',
            );
        } finally {
            busyRef.current = null;
            setBusy(null);
        }
    }

    async function chooseFile(file: File) {
        if (busyRef.current) return;

        setUpload(null);
        setPreview(null);
        setAddressFields([]);
        setAddressField('');
        setGeocode(null);
        setAcs(null);
        setEnriched(null);
        setFileName(file.name);

        const ext = file.name.split('.').pop()?.toLowerCase();

        if (!ext || !['csv', 'xls', 'xlsx'].includes(ext)) {
            setError('Please select a CSV or Excel file (.csv, .xls, .xlsx).');
            return;
        }

        const ready = await run('upload', async () => {
            setPreview(await parsePreview(file));

            const info = await api.uploadFile(file);
            setUpload(info);

            const fields = await api.fetchAddressFields(info);
            setAddressFields(fields);
            setAddressField(fields[0] ?? '');

            return { info, field: fields[0] ?? '' };
        });

        // Geocode straight away when an address field was detected. State from
        // the upload isn't visible to this closure yet, so pass it explicitly.
        if (ready?.field) {
            await run('geocode', () =>
                geocodeWith(ready.info, ready.field),
            );
        }
    }

    // A typed address is handled as a one-row CSV with a single address column.
    function chooseAddress(address: string) {
        const value = address.trim();

        if (!value) return Promise.resolve();

        const csv = `address\n"${value.replaceAll('"', '""')}"\n`;

        return chooseFile(
            new File([csv], 'address.csv', { type: 'text/csv' }),
        );
    }

    // Results built from another address field no longer apply.
    function chooseAddressField(field: string) {
        if (busyRef.current || field === addressField) return;

        setAddressField(field);
        setGeocode(null);
        setAcs(null);
        setEnriched(null);
    }

    async function geocodeWith(info: api.UploadInfo, field: string) {
        setGeocode(await api.runGeocode(info, field));
        setAcs(null);
        setEnriched(null);
    }

    const geocodeStep = () =>
        run('geocode', async () => {
            if (!upload || !addressField) {
                throw new Error('Select an address field first.');
            }

            await geocodeWith(upload, addressField);
        });

    const acsStep = () =>
        run('acs', async () => {
            if (!upload || !geocode) {
                throw new Error('Run the geocoder first.');
            }

            if (!selectedAcsColumns.length) {
                throw new Error('Select at least one ACS column.');
            }

            const result = await api.runAcs(
                upload,
                geocode.tempPath,
                selectedAcsColumns,
            );

            setAcs(result);
            setAcsUsed(selectedAcsColumns);
            setEnriched(null);
        });

    const enrichStep = (opts: {
        geo: boolean;
        acs: boolean;
        fields?: string[];
        join?: 'left' | 'inner';
        outputName: string;
    }) =>
        run('enrich', async () => {
            if (!upload) {
                throw new Error('Upload a file first.');
            }

            const result = await api.runEnrich(upload, {
                ...opts,
                ...(opts.geo && { geocodeFile: geocode?.tempPath }),
                ...(opts.acs && { acsFile: acs?.tempPath }),
            });

            setEnriched(result);

            await api.downloadFile(result.sessionId, result.filename);
        });

    // The ACS sidecar no longer matches the picker if the selection changed since it ran.
    const acsStale =
        !!acs &&
        JSON.stringify(acsUsed) !== JSON.stringify(selectedAcsColumns);

    return {
        upload,
        fileName,
        preview,
        addressFields,
        addressField,
        setAddressField: chooseAddressField,
        geocode,
        acs,
        acsStale,
        enriched,
        busy,
        error,
        chooseFile,
        chooseAddress,
        geocodeStep,
        acsStep,
        enrichStep,
    };
}
