// Proves the backend is alive and correctly configured. The first thing to check whenever
// the dashboard looks wrong. Answers without a session, so a host's health check can use it.

import { Router } from 'express';
import { config, hasSapKey } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fico-dashboard-api',
    dataSource: config.dataSource,
    sapKeyLoaded: hasSapKey,
    checkedAt: new Date().toISOString()
  });
});
