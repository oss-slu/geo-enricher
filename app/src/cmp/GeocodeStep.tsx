// GeocodeStep.tsx
import PreviewTable from './PreviewTable';
import type { GeocodeResult } from '../api/files';

export default function GeocodeStep({ fields, field, onField, result, busy, onRun }: {
    fields: string[];
    field: string;
    onField: (f: string) => void;
    result: GeocodeResult | null;
    busy: boolean;
    onRun: () => void;
}) {
    return (
        <div>
            <label htmlFor="join-field"><b>Potential address field(s): </b></label>
            <select id="join-field" value={field} onChange={(e) => onField(e.target.value)}>
                {fields.map((f) => <option key={f}>{f}</option>)}
            </select>
            <button type="button" disabled={!field || busy} onClick={onRun}>
                {busy ? 'Geocoding…' : 'Geocode addresses'}
            </button>

            {result && (
                <>
                    <p>{result.counts.matched} matched, {result.counts.unmatched} unmatched, {result.counts.invalidOrBlank} invalid or blank</p>
                    <PreviewTable preview={{
                        headers: result.preview.columns.map((c) => c.label),
                        rows: result.preview.rows as (string | number | boolean)[][],
                    }} />
                </>
            )}
        </div>
    );
}