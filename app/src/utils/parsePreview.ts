import * as XLSX from 'xlsx';
import type { PreviewData } from '../cmp/PreviewTable';

export async function parsePreview(file: File): Promise<PreviewData> {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const buffer = await file.arrayBuffer();
    let workbook: XLSX.WorkBook;

    if (extension === 'csv') {
        const bytes = new Uint8Array(buffer);
        const encoding =
            bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
            : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
            : 'utf-8';
        workbook = XLSX.read(new TextDecoder(encoding).decode(bytes), { type: 'string', cellDates: true });
    } else {
        workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error('The selected file has no readable worksheet.');

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (matrix.length === 0) throw new Error('The selected file contains no data.');

    const headers = matrix[0].map((v, i) => String(v || `Column ${i + 1}`));
    const rows = matrix.slice(1).map((row) =>
        headers.map((_, i) => {
            const v = row[i];
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
            return v == null ? '' : String(v);
        }),
    );

    return { headers, rows };
}