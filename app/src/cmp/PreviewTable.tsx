import { useState } from 'react';
import { PREVIEW_LIMIT } from '../consts';

export type CellValue = string | number | boolean | null;
export type PreviewData = {
    headers: string[];
    rows: CellValue[][];
};

function PreviewTable({ preview }: { preview: PreviewData }) {
    const [showAllRows, setShowAllRows] = useState(false);

    const visibleRows = showAllRows
        ? preview.rows
        : preview.rows.slice(0, PREVIEW_LIMIT);

    return (
        <div className='preview-section'>
            <h3>Dataset preview</h3>
            <div style={{ overflowX: 'auto' }}>
                <table>
                    <thead>
                        <tr>
                            {preview.headers.map((header, index) => (
                                <th key={`${header}-${index}`}>{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                {preview.headers.map((_, columnIndex) => (
                                    <td key={columnIndex}>
                                        {String(row[columnIndex] ?? '')}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className='showing-rows'>Showing {visibleRows.length} of {preview.rows.length} rows {
                preview.rows.length > PREVIEW_LIMIT && (
                    <button
                        type="button"
                        onClick={() => setShowAllRows((current) => !current)}
                    >
                        {showAllRows ? 'Show fewer' : 'Show more'}
                    </button>
                )
            }</div>
            
        </div>
    );
}

export default PreviewTable;