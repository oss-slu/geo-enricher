// UploadStep.tsx
import { useState, type SubmitEvent } from 'react';
import PreviewTable, { type PreviewData } from '../PreviewTable';
import { ADDR_EXAMPLES } from '../../consts';

type UploadStepProps = {
    fileName: string | null;
    preview: PreviewData | null;
    busy: boolean;
    onFile: (f: File) => void;
    onAddress: (a: string) => void;
};

export default function UploadStep({ fileName, preview, busy, onFile, onAddress }: UploadStepProps) {
    const [address, setAddress] = useState('');

    function onSubmit(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        onAddress(address);
    }

    return (
        <div className="upload">
            <div>
            <label htmlFor='dataset-file' className='upload-msg'>Upload a CSV or Excel file...</label>
                <span className='help' aria-describedby='addr-help'>
                    ? <span id='addr-help' role='tooltip' className='help-tip'>
                        <span>Uploaded file must contain a field with valid US addresses containing street name/number, city, state, and optional zip code e.g.</span>
                        <ul>
                            {ADDR_EXAMPLES.map(e => (
                                <li key={e}>{e}</li>
                            ))}
                        </ul>
                    </span>
                </span>
            </div>
            <input
                id="dataset-file"
                type="file"
                accept=".csv,.xls,.xlsx"
                disabled={busy}
                onChange={(e) => {
                    if (!e.target.files?.[0]) return;
                    setAddress('');
                    onFile(e.target.files[0]);
                }}
            />
            {fileName && <p><small><i>Uploaded {fileName}</i></small></p>}

            <form onSubmit={onSubmit}>
                <label htmlFor='single-addr' className='upload-msg'>...or enter a single address</label>
                <input
                    id='single-addr'
                    type='text'
                    value={address}
                    disabled={busy}
                    placeholder={ADDR_EXAMPLES[0]}
                    onChange={(e) => setAddress(e.target.value)}
                />
                <button type='submit' disabled={busy || !address.trim()}>Use address</button>
            </form>
            {preview && <PreviewTable className='upload-preview' heading='File Preview' preview={preview} />}
        </div>
    );
}