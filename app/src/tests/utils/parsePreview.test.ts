import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parsePreview } from '../../utils/parsePreview';

const text = 'address,name\n"123 Main St, St Louis, MO",Zoë\n';

function utf16(value: string, endian: 'le' | 'be') {
    const le = Buffer.from(value, 'utf16le');
    if (endian === 'be') le.swap16();
    const bom = endian === 'le' ? [0xff, 0xfe] : [0xfe, 0xff];
    return new Uint8Array([...bom, ...le]);
}

describe('parsePreview', () => {
    it.each([
        ['UTF-8', new TextEncoder().encode(text)],
        ['UTF-16LE', utf16(text, 'le')],
        ['UTF-16BE', utf16(text, 'be')],
    ])('reads %s CSV', async (_, bytes) => {
        const preview = await parsePreview(new File([bytes], 'input.csv'));
        expect(preview).toEqual({
            headers: ['address', 'name'],
            rows: [['123 Main St, St Louis, MO', 'Zoë']],
        });
    });

    it.each(['xlsx', 'xls'] as const)('reads %s workbooks', async (bookType) => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.aoa_to_sheet([
                ['address', 'count', 'active'],
                ['123 Main St', 3, true],
            ]),
            'Sheet1',
        );
        const bytes = XLSX.write(book, { type: 'array', bookType });
        const preview = await parsePreview(new File([bytes], `input.${bookType}`));
        expect(preview).toEqual({
            headers: ['address', 'count', 'active'],
            rows: [['123 Main St', 3, true]],
        });
    });

    it('names blank headers and fills missing cells', async () => {
        const preview = await parsePreview(new File([',name,\n1\n'], 'input.csv'));
        expect(preview.headers).toEqual(['Column 1', 'name', 'Column 3']);
        expect(preview.rows).toEqual([[1, '', '']]);
    });

    it('rejects empty files', async () => {
        await expect(parsePreview(new File([''], 'input.csv'))).rejects.toThrow(
            'The selected file contains no data.',
        );
    });
});
