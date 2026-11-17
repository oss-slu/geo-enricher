import { useState } from 'react';
import { TABLE_IDS, URLS } from '../consts';
import ColumnSelector from './ColumnSelector';
import MenuBar from './MenuBar';
import GeocodeStep from './GeocodeStep';
import { useEnrichFlow } from '../hooks/useEnrichFlow';
import UploadStep from './UploadStep';
import EnrichStep from './EnrichStep';
import PreviewTable from './PreviewTable';
import type { SelectedAcsColumn } from '../api/files';

export default function App() {
    const [selectedAcsColumns, setSelectedAcsColumns] = useState<SelectedAcsColumn[]>([]);
    const f = useEnrichFlow(selectedAcsColumns);
    
    return (
        <main>
            <MenuBar justify='space-between' gap='0.5rem' padding='0' className='top-menu'>
                <a href={URLS.OSS_URL} target="_blank"><img src={URLS.OSS_IMG} height='50px'></img></a>
                <h1>Geo-Enricher</h1>
                <div className='src'>
                    <img src={URLS.GH_IMG} height='40px'></img>
                    <h3>View the <a href={URLS.SRC_URL} target="_blank">Source Code</a></h3>
                </div>
            </MenuBar>

            <UploadStep fileName={f.fileName} preview={f.preview} busy={f.busy === 'upload'} onFile={f.chooseFile} />
            {f.error && <p role="alert">{f.error}</p>}

            {f.upload && (
                <GeocodeStep
                    fields={f.addressFields} field={f.addressField} onField={f.setAddressField}
                    result={f.geocode} busy={f.busy === 'geocode'} onRun={() => f.geocodeStep()}
                />

            )}

            <ColumnSelector table_ids={TABLE_IDS} onSelectionChange={setSelectedAcsColumns} />

            {f.upload && (
                <>
                    <button
                        type="button"
                        disabled={!f.geocode || !selectedAcsColumns.length || f.busy !== null}
                        onClick={() => f.acsStep()}
                    >{f.busy === 'acs' ? 'Fetching...' : 'Fetch ACS data'}</button>
                    {f.acsStale && <p>ACS selection changed since the last fetch. Fetch again.</p>}
                    {f.acs && (
                        <>
                            <p>{f.acs.counts.withAcs} of {f.acs.counts.input} rows have ACS data</p>
                            <PreviewTable
                                key={f.acs.filename}
                                preview={{
                                    headers: f.acs.preview.columns.map((c) => c.label),
                                    rows: f.acs.preview.rows as (string | number | boolean)[][],
                                }}
                            />
                        </>
                    )}
                    <EnrichStep
                        geocodeDone={!!f.geocode} acsDone={!!f.acs} acsStale={f.acsStale}
                        busy={f.busy === 'enrich'} onEnrich={f.enrichStep}
                    />
                </>
            )}
        </main>
    );
}