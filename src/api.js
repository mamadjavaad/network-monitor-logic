import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTrafficHistory, getProcessSummary, getTrafficTimeline, getRecentAlerts, acknowledgeAlert } from './db.js';


const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

const FRONTEND_DIST = path.join(CURRENT_DIR, '..', 'public');

let cachedConnections = [];
let lastUpdate = null;

export function setConnections(connections) {
  cachedConnections = connections;
  lastUpdate = new Date().toISOString();
}

export function getConnections() {
  return { connections: cachedConnections, lastUpdate, count: cachedConnections.length };
}

export function createApp() {
  const app = express();
  app.use(cors()); 
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/connections', (req, res) => {
    res.json(getConnections());
  });

  app.get('/api/processes/summary', (req, res) => {
    try {
      const processes = getProcessSummary();
      res.json({ processes, count: processes.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  app.get('/api/history/timeline', (req, res) => {
    try {
      const minutes = parseInt(req.query.minutes || '30', 10);
      const buckets = getTrafficTimeline({ minutes });
      res.json({ buckets, count: buckets.length, minutes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/history/:pid', (req, res) => {
    try {
      const pid = parseInt(req.params.pid, 10);
      const { since, until } = req.query;
      const samples = getTrafficHistory(pid, { since, until });
      res.json({ pid, samples, count: samples.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/alerts', (req, res) => {
    try {
      const limit = parseInt(req.query.limit || '20', 10);
      const alerts = getRecentAlerts(limit);
      res.json({ alerts, count: alerts.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/alerts/:id/acknowledge', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const ok = acknowledgeAlert(id);
      res.json({ ok });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));

    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });

    console.log(`[Frontend] Serving built UI from ${FRONTEND_DIST}`);
  } else {
    console.log('[Frontend] No build found at', FRONTEND_DIST, '— API-only mode');
  }

  return app;
}