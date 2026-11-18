import { useEffect, useState } from 'react';
import type { SelectedAcsColumn } from '../api/files';

type MetadataRow = {
    table_id: string;
    table_title: string;
    column_id: string;
    column_title: string;
};

type MetadataResponse = {
    ok: boolean;
    data?: MetadataRow[];
    message?: string;
};

type AcsColumnSelectorProps = {
    tableIds: string[];
    onSelectionChange: (columns: SelectedAcsColumn[]) => void;
};

export default function ColumnSelector({ tableIds, onSelectionChange }: AcsColumnSelectorProps) {
    const [metadata, setMetadata] = useState<MetadataRow[]>([]);
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        async function loadMetadata() {
            try {
                const params = new URLSearchParams();

                tableIds.forEach(table => params.append('tables', table));

                const response = await fetch(
                    `/api/acs-metadata?${params.toString()}`,
                    { signal: controller.signal },
                );

                const result: MetadataResponse = await response.json();

                if (!response.ok || !result.ok) {
                    throw new Error(
                        result.message ?? 'Failed to load ACS metadata.',
                    );
                }
                setMetadata(result.data ?? []);
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Failed to load ACS metadata.');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }

        void loadMetadata();

        return () => controller.abort();
    }, []);

    function commit(next: Set<string>) {
        setSelectedColumns(next);
        onSelectionChange(
            metadata
                .filter((row) => next.has(row.column_id))
                .map((row) => ({ table_id: row.table_id, column_id: row.column_id })),
        );
    }

    function toggleColumn(columnId: string) {
        const next = new Set(selectedColumns);
        next.has(columnId) ? next.delete(columnId) : next.add(columnId);
        commit(next);
    }

    function clearColumns(tableId?: string) {
        const next = tableId
            ? new Set([...selectedColumns].filter((id) => !metadata.some((r) => r.table_id === tableId && r.column_id === id)))
            : new Set<string>();
        commit(next);
    }

    const tables = Array.from(
        new Map(
            metadata.map((row) => [
                row.table_id,
                {
                    table_id: row.table_id,
                    table_title: row.table_title,
                },
            ]),
        ).values(),
    );

    return (
        <details className='acs-selector' open>
            <summary id='acs-selector-heading'>
                Select ACS (American Community Survey) data fields to add to file
                {selectedColumns.size > 0 && ` (${selectedColumns.size} selected)`}
            </summary>
            <section aria-labelledby="acs-selector-heading">
                <p><i>Expand tables to select from available fields</i></p>

                {loading && <p role="status">Loading ACS metadata...</p>}

                {error && <p role="alert">{error}</p>}

                {!loading && !error && tables.length === 0 && <p>No ACS metadata available.</p>}

                {!loading && !error && tables.length > 0 && (
                    <div className='col-sel-cont'>
                        {tables.map((table) => {
                            const columns = metadata.filter(row => row.table_id === table.table_id);
                            const selectedInTable = columns.filter(c => selectedColumns.has(c.column_id)).length;
                            return (
                                <details key={table.table_id} className='col-sel-opt-outer-cont'>
                                    {/* table name displayed here */}
                                    <summary>
                                        <b>{table.table_id}:</b> <span className='ttl'><u><small>{table.table_title}</small></u></span>
                                    </summary>

                                    <div className='col-sel-opt-inner-cont'>
                                        {columns.map((column) => (
                                            <div key={column.column_id} className='col-sel-inner-opt'>
                                                <label className='col-label'>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedColumns.has(column.column_id)}
                                                        onChange={() => toggleColumn(column.column_id)}
                                                    />
                                                    <b>{column.column_id}:</b> {column.column_title}
                                                </label>
                                            </div>
                                        ))}
                                        {selectedInTable > 0 && (
                                            <button className='clear-btn' onClick={() => clearColumns(table.table_id)}>
                                                Clear {selectedInTable} selected field(s) from <i>{table.table_id}</i>
                                            </button>
                                        )}
                                    </div>
                                </details>
                            );
                        })}
                    </div>
                )}
                {selectedColumns.size > 0 && (
                    <button className='clear-btn' onClick={() => clearColumns()}>
                        Clear {selectedColumns.size > 0 && ` ${selectedColumns.size} selected`} field(s)
                    </button>
                )}
            </section>
        </details>
    );
};
