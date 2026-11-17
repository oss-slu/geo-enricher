// UploadStep.tsx
import PreviewTable, { type PreviewData } from './PreviewTable';
import { ADDR_EXAMPLES } from '../consts';

export default function UploadStep({ fileName, preview, busy, onFile }: {
    fileName: string | null;
    preview: PreviewData | null;
    busy: boolean;
    onFile: (f: File) => void;
}) {
    return (
        <div className="upload-heading">
            <div>
            <label htmlFor='dataset-file' className='upload-msg'>Upload a CSV or Excel file...</label>
                <span className='help' tabIndex={0} aria-describedby='addr-help'>
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
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            {fileName && <p><small>Selected <i>{fileName}</i></small></p>}
            {preview && <PreviewTable heading='File Preview' preview={preview} />}
        </div>
    );
}