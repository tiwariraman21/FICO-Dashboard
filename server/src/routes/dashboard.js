// One route that returns the whole picture.
//
// The company-code selector re-filters every screen at once, so the browser needs
// everything in hand anyway, and one request means one chance to fail rather than eight
// chances to show half a page.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getEverything } from '../data-service.js';
import { config } from '../config.js';
import { readActionLog } from '../store.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const data = await getEverything(req.user);
    res.json({
      ...data,
      user: { email: req.user.username, name: req.user.name },
      dataSource: config.dataSource
    });
  })
);

dashboardRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    res.json({ entries: readActionLog() });
  })
);
