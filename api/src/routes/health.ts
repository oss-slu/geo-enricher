import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
    res.json({
        ok: true,
        message: `express server is healthy`,
    });
});

export default router;
