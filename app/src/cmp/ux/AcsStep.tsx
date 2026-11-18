import type { AcsResult, SelectedAcsColumn } from "../../api/files";
import ColumnSelector from "../ColumnSelector";
import PreviewTable from "../PreviewTable";

type AcsStepProps = {
    canFetch: boolean;
    fetching: boolean;
    stale: boolean;
    result: AcsResult | null;
    tableIds: string[];
    onFetch: () => void;
    onSelectionChange: (columns: SelectedAcsColumn[]) => void;
};

export default function AcsStep({ canFetch, fetching, stale, result, tableIds, onFetch, onSelectionChange }: AcsStepProps) {
    return (
        <>
            <ColumnSelector tableIds={tableIds} onSelectionChange={onSelectionChange} />

            <button type="button" disabled={!canFetch} onClick={onFetch}>
                {fetching ? 'Fetching...' : 'Fetch ACS Data'}
            </button>

            {stale && <p>ACS selection changed since last fetch</p>}
            
            {result && (
                <>
                    <p>{result.counts.withAcs} of {result.counts.input} matching rows in ACS database</p>
                    <PreviewTable
                        heading='ACS Results'
                        preview={{
                            headers: result.preview.columns.map((c) => c.label),
                            rows: result.preview.rows as (string | number | boolean)[][],
                        }}
                    />
                </>
            )}
        </>
    )
}