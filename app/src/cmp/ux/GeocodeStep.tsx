import PreviewTable from '../PreviewTable';
import type { GeocodeResult } from '../../api/files';

type GeocodeStepProps = {
    fields: string[];
    field: string;
    onField: (f: string) => void;
    result: GeocodeResult | null;
    busy: boolean;
    disabled?: boolean; // true while any step is running
    onRun: () => void;
};

export default function GeocodeStep({
    fields, field, onField, result, busy, disabled = busy, onRun }: GeocodeStepProps
) {
    return (
        <div>
            <label htmlFor="join-field"><b>Potential address field(s): </b></label>
            <select id="join-field" value={field} disabled={disabled} onChange={(e) => onField(e.target.value)}>
                {fields.map((f) => <option key={f}>{f}</option>)}
            </select>
            <button type="button" disabled={!field || disabled} onClick={onRun}>
                {busy ? 'Geocoding…' : 'Geocode addresses'}
            </button>

            {result && (
                <>
                    <p>{result.counts.matched} matched, {result.counts.unmatched} unmatched, {result.counts.invalidOrBlank} invalid or blank</p>
                    <PreviewTable heading='Geocoder results' preview={{
                        headers: result.preview.columns.map((c) => c.label),
                        rows: result.preview.rows as (string | number | boolean)[][],
                    }} />
                </>
            )}
        </div>
    );
}