import { Router } from 'express';
import {
    readSessionFilename,
    validateSessionId,
} from '../utils/storage';
import { fileResponseError } from '../utils/fileResponse';
import { FileError } from '../errs/file';

const router = Router();

const CONTENT_TYPES: Record<string, string> = {
    csv: 'text/csv; charset=utf-8',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

router.get('/download-file', async (req, res) => {
    try {
        const sessionId = req.query.sessionId;
        const filename = req.query.filename;

        if (typeof sessionId !== 'string' || !sessionId) {
            throw new FileError(
                400,
                'INVALID_SESSION',
                'sessionId is required',
            );
        }

        if (typeof filename !== 'string' || !filename) {
            throw new FileError(
                400,
                'INVALID_FILENAME',
                'filename is required',
            );
        }

        validateSessionId(sessionId);

        const extension = filename.split('.').pop()?.toLowerCase() ?? '';
        const contentType = CONTENT_TYPES[extension];

        if (!contentType) {
            throw new FileError(
                400,
                'INVALID_FILE_TYPE',
                'Only CSV, XLS, and XLSX files can be downloaded',
            );
        }

        const buffer = await readSessionFilename(sessionId, filename);

        res.setHeader('Content-Type', contentType);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`,
        );
        res.setHeader('Content-Length', buffer.length);

        res.status(200).send(buffer);
    } catch (err) {
        fileResponseError(res, err);
    }
});

router.all('/download-file', (_req, res) => {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
        success: false,
        code: 'METHOD_NOT_ALLOWED',
        error: 'Method not allowed',
    });
});

export default router;