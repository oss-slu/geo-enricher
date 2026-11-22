
import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { saveSessionFile, deleteSessionDir } from '../utils/storage';
import { FileError } from '../errs/file';

const router = express.Router();

// Rate limiter (max 100 requests per 15 minutes per IP)
const fileOpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
        error: 'Too many file operations from this IP, please try again later.',
    },
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.csv', '.xls', '.xlsx'];

        if (allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    'Invalid file type. Only CSV and Excel files are allowed.',
                ),
            );
        }
    },
});

router.get('/', (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed' });
});

router.post(
    '/',
    fileOpLimiter,
    upload.single('file'),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No valid file uploaded' });
        }

        try {
            const sessionId = crypto.randomUUID();

            const filename = path.basename(
                req.file.originalname.replace(/\\/g, '/'),
            ).replace(/\s+/g, '_');

            const outputPath = await saveSessionFile(
                sessionId,
                filename,
                req.file.buffer,
            );

            res.json({
                success: true,
                sessionId,
                filename,
                tempPath: outputPath,
            });
        } catch (err) {
            console.error('File upload error:', err);
            res.status(500).json({ error: 'Failed to save file' });
        }
    },
);

router.delete('/:sessionId', fileOpLimiter, async (req, res) => {
    const sessionId = req.params.sessionId as string;

    const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }

    try {
        await deleteSessionDir(sessionId);
        res.json({ success: true });
    } catch (err) {
        if (err instanceof FileError) {
            return res
                .status(err.status)
                .json({ success: false, code: err.code, error: err.message });
        }

        console.error('Cleanup error:', err);
        res.status(500).json({ error: 'Failed to clean up directory' });
    }
});

export default router;
