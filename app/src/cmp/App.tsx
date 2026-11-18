import { useState } from 'react';
import { TABLE_IDS, URLS } from '../consts';
import MenuBar from './MenuBar';
import GeocodeStep from './GeocodeStep';
import { useEnrichFlow } from '../hooks/useEnrichFlow';
import UploadStep from './UploadStep';
import EnrichStep from './EnrichStep';
import type { SelectedAcsColumn } from '../api/files';
import AcsStep from './AcsStep';

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

            <UploadStep
                fileName={f.fileName} preview={f.preview}
                busy={f.busy !== null} onFile={f.chooseFile}
            />
            {f.error && <p role="alert">{f.error}</p>}

            <GeocodeStep
                fields={f.addressFields} field={f.addressField} onField={f.setAddressField}
                result={f.geocode} busy={f.busy === 'geocode'} disabled={f.busy !== null}
                onRun={() => f.geocodeStep()}
            />

            <AcsStep
                canFetch={!!f.geocode && selectedAcsColumns.length > 0 && f.busy === null}
                fetching={f.busy === 'acs'}
                stale={f.acsStale}
                result={f.acs}
                onFetch={() => f.acsStep()}
                tableIds={TABLE_IDS}
                onSelectionChange={setSelectedAcsColumns}
            />

            <EnrichStep
                geocodeDone={!!f.geocode} acsDone={!!f.acs} acsStale={f.acsStale}
                busy={f.busy === 'enrich'} disabled={f.busy !== null} onEnrich={f.enrichStep}
            />
        </main>
    );
}