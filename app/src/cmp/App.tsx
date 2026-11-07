import { useState } from 'react';
import DatasetGeoJoiner from './DatasetGeoJoiner';
import AcsColumnSelector from './AcsColumnSelector';
import { TABLE_IDS } from '../consts';

export type SelectedAcsColumn = {
    table_id: string;
    column_id: string;
};

function App() {
    const [selectedAcsColumns, setSelectedAcsColumns] = useState<
        SelectedAcsColumn[]
    >([]);

    return (
        <>
            <main>
                <h1>Open Source with SLU</h1>

                <AcsColumnSelector
                    table_ids={TABLE_IDS}
                    onSelectionChange={setSelectedAcsColumns}
                />

                <DatasetGeoJoiner
                    selectedAcsColumns={selectedAcsColumns}
                />
            </main>
        </>
    );
}

export default App;