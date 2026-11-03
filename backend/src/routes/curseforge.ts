// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { requireGlobalPermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../permissions.js';
import { curseForgeCatalog, getCurseForgeApiKey } from '../services/curseforge.js';
import { sendRouteError } from '../utils/routeErrors.js';

const router = Router();
router.use(requireGlobalPermission(PERMISSIONS.server.install));

router.get('/status', async (_req, res) => {
    try {
        await getCurseForgeApiKey();
        res.json({ configured: true });
    } catch {
        res.json({ configured: false });
    }
});

router.get('/modpacks', async (req, res) => {
    try {
        res.json(await curseForgeCatalog.search({ query: req.query.query, sort: req.query.sort, offset: req.query.offset }));
    } catch (error) {
        sendRouteError(res, error, { route: 'CURSEFORGE:SEARCH', fallbackMessage: 'Could not search CurseForge' });
    }
});

router.get('/modpacks/:projectId/versions', async (req, res) => {
    try {
        res.json(await curseForgeCatalog.versions(req.params.projectId, req.query.offset));
    } catch (error) {
        sendRouteError(res, error, { route: 'CURSEFORGE:VERSIONS', fallbackMessage: 'Could not load modpack versions' });
    }
});

export default router;
