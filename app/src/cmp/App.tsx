import { useState } from 'react';
import { TABLE_IDS, URLS } from '../consts';
import DatasetGeoJoiner from './DatasetGeoJoiner';
import ColumnSelector from './ColumnSelector';
import MenuBar from './MenuBar';
import Enricher from './Enricher';

export type SelectedAcsColumn = {
    table_id: string;
    column_id: string;
};

function App() {
    const [selectedAcsColumns, setSelectedAcsColumns] = useState<SelectedAcsColumn[]>([]);
    // const [enrichWith, setEnrichWith] = useState<[boolean, boolean]>([false, false]);
    const [writeGeo, setWriteGeo] = useState(false);
    const [writeAcs, setWriteAcs] = useState(false);
    
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
            <DatasetGeoJoiner selectedAcsColumns={selectedAcsColumns} />
            <ColumnSelector table_ids={TABLE_IDS} onSelectionChange={setSelectedAcsColumns} />
            <Enricher writeGeo={writeGeo} writeAcs={writeAcs} onGeoChange={setWriteGeo} onAcsChange={setWriteAcs}/>
        </main>
    );
}

export default App;