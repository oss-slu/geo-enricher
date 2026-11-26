
import { jest } from '@jest/globals';

type QueryRow = Record<string, unknown>;

const query = jest.fn<
    (text: string, params?: unknown[]) => Promise<{ rows: QueryRow[] }>
>();

jest.unstable_mockModule('../../db/connect', () => ({ query }));

const {
    normalizeGeoid,
    getAcsColumnMetadata,
    queryACSForGeoid,
} = await import('../../utils/acs');

describe('ACS utility', () => {
    beforeEach(() => {
        query.mockReset();
    });

    describe('normalizeGeoid', () => {
        it('accepts a raw 12-digit GEOID', () => {
            expect(normalizeGeoid('290000000000')).toBe(
                '15000US290000000000',
            );
        });

        it('accepts a GEOID with the 15000US prefix', () => {
            expect(normalizeGeoid('15000US290000000000')).toBe(
                '15000US290000000000',
            );
        });

        it.each(['12345', '', null, 123456789012, '../invalid'])(
            'rejects invalid GEOID %s',
            (geoid) => {
                expect(() => normalizeGeoid(geoid)).toThrow(
                    'GEOID must be a 12-digit block-group GEOID',
                );
            },
        );
    });

    describe('getAcsColumnMetadata', () => {
        const selections = [
            { table_id: 'B02001', column_id: 'B02001001' },
            { table_id: 'b02001', column_id: 'b02001002' },
        ];

        it('retrieves selected ACS column titles', async () => {
            query.mockResolvedValueOnce({
                rows: [
                    {
                        table_id: 'b02001',
                        column_id: 'b02001001',
                        column_title: 'Total:',
                    },
                    {
                        table_id: 'b02001',
                        column_id: 'b02001002',
                        column_title: 'White alone',
                    },
                ],
            });

            const result = await getAcsColumnMetadata(selections);

            expect(result).toEqual([
                {
                    table_id: 'b02001',
                    column_id: 'b02001001',
                    column_title: 'Total:',
                },
                {
                    table_id: 'b02001',
                    column_id: 'b02001002',
                    column_title: 'White alone',
                },
            ]);

            expect(query).toHaveBeenCalledTimes(1);
            expect(query.mock.calls[0][0]).toContain('column_title');
        });

        it('matches metadata without regard to ID casing', async () => {
            query.mockResolvedValueOnce({
                rows: [
                    {
                        table_id: 'b02001',
                        column_id: 'b02001001',
                        column_title: 'Total:',
                    },
                ],
            });

            const result = await getAcsColumnMetadata([
                { table_id: 'B02001', column_id: 'B02001001' },
            ]);

            expect(result[0].column_title).toBe('Total:');
        });

        it('rejects selections that do not exist in metadata', async () => {
            query.mockResolvedValueOnce({ rows: [] });

            await expect(
                getAcsColumnMetadata([
                    { table_id: 'B02001', column_id: 'B02001999' },
                ]),
            ).rejects.toMatchObject({
                code: 'INVALID_ACS_COLUMNS',
            });
        });

        it('rejects metadata without a column title', async () => {
            query.mockResolvedValueOnce({
                rows: [
                    {
                        table_id: 'b02001',
                        column_id: 'b02001001',
                        column_title: '   ',
                    },
                ],
            });

            await expect(
                getAcsColumnMetadata([
                    { table_id: 'B02001', column_id: 'B02001001' },
                ]),
            ).rejects.toMatchObject({
                code: 'INVALID_ACS_COLUMNS',
            });
        });

        it('does not query the database for empty selections', async () => {
            const result = await getAcsColumnMetadata([]);

            expect(result).toEqual([]);
            expect(query).not.toHaveBeenCalled();
        });
    });

    describe('queryACSForGeoid', () => {
        const selections = [
            { table_id: 'B02001', column_id: 'B02001001' },
            { table_id: 'B02001', column_id: 'B02001002' },
        ];

        const metadata = [
            {
                table_id: 'b02001',
                column_id: 'b02001001',
                column_title: 'Total:',
            },
            {
                table_id: 'b02001',
                column_id: 'b02001002',
                column_title: 'White alone',
            },
        ];

        it('queries selected ACS columns for a GEOID', async () => {
            query
                .mockResolvedValueOnce({
                    rows: metadata,
                })
                .mockResolvedValueOnce({
                    rows: [{
                        geoid: '15000US290000000000',
                        b02001_b02001001: 100,
                        b02001_b02001002: 75,
                    }],
                });

            const result = await queryACSForGeoid(
                '290000000000',
                selections,
            );

            expect(result).toEqual({
                geoid: '15000US290000000000',
                b02001_b02001001: 100,
                b02001_b02001002: 75,
            });

            expect(query).toHaveBeenCalledTimes(2);
            expect(query.mock.calls[1][1]).toEqual([
                '15000US290000000000',
            ]);
        });

        it('uses supplied validated metadata without another metadata query', async () => {
            query.mockResolvedValueOnce({
                rows: [{
                    geoid: '15000US290000000000',
                    b02001_b02001001: 100,
                    b02001_b02001002: 75,
                }],
            });

            const result = await queryACSForGeoid(
                '290000000000',
                selections,
                metadata,
            );

            expect(result).toMatchObject({
                b02001_b02001001: 100,
                b02001_b02001002: 75,
            });

            expect(query).toHaveBeenCalledTimes(1);
        });

        it('rejects a column that does not belong to the selected table', async () => {
            query.mockResolvedValueOnce({
                rows: [
                    {
                        table_id: 'b02001',
                        column_id: 'b02001001',
                        column_title: 'Total:',
                    },
                ],
            });

            await expect(
                queryACSForGeoid('290000000000', [
                    { table_id: 'B02001', column_id: 'B02001999' },
                ]),
            ).rejects.toMatchObject({
                code: 'INVALID_ACS_COLUMNS',
            });

            expect(query).toHaveBeenCalledTimes(1);
        });

        it('returns null when no ACS record exists', async () => {
            query
                .mockResolvedValueOnce({
                    rows: metadata,
                })
                .mockResolvedValueOnce({ rows: [] });

            const result = await queryACSForGeoid(
                '290000000000',
                [{ table_id: 'B02001', column_id: 'B02001001' }],
            );

            expect(result).toBeNull();
        });

        it('does not query the database when no columns are selected', async () => {
            const result = await queryACSForGeoid(
                '290000000000',
                [],
            );

            expect(result).toEqual({});
            expect(query).not.toHaveBeenCalled();
        });
    });
});
