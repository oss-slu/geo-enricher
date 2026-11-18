import express, { type Request, type Response } from 'express';
import { FileError } from '../errs/file';
import { geoSidecar, acsSidecar } from '../dataset/sidecars';
import { enrichFile } from '../dataset/enrichFile';

const router = express.Router();
router.use(express.json({ limit: '1mb' })); // bodies are only options now, so keep this small

type Step = (
    path: string,
    options: unknown,
    signal: AbortSignal,
) => Promise<unknown>;

function fileRoute(step: Step) {
    return async (req: Request, res: Response) => {
        const controller = new AbortController();

        // Stop geocoding/ACS work if the client goes away before we respond.
        res.on('close', () => {
            if (!res.writableFinished) controller.abort();
        });

        try {
            const { path, ...options } = req.body ?? {};

            if (typeof path !== 'string' || !path) {
                throw new FileError(400, 'INVALID_PATH', 'path is required');
            }

            const result = await step(path, options, controller.signal);
            res.json(result);
        } catch (err) {
            if (err instanceof FileError) {
                // Adjust field names to match your FileError class.
                res.status(err.status).json({
                    error: { code: err.code, message: err.message, details: err.message },
                });
                return;
            }

            console.error(err);
            res.status(500).json({
                error: { code: 'INTERNAL', message: 'Unexpected error' },
            });
        }
    };
}

router.post('/geocode', fileRoute((p, o, s) => geoSidecar(p, o, s)));
router.post('/acs', fileRoute((p, o, s) => acsSidecar(p, o, s)));
router.post('/enrich', fileRoute((p, o, s) => enrichFile(p, o, s)));

router.use((_req, res) => {
    res.status(404).json({ error: 'no route in files router' });
});

export default router;