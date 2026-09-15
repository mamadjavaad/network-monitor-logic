import express from 'express';
import cors from 'cors';
import { getTrafficHistory, getAllProcesses, getProcessSummary } from './db.js';

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

  app.get('/api/connections/:pid', (req, res) => {
    const pid = parseInt(req.params.pid, 10);
    const filtered = cachedConnections.filter((c) => c.pid === pid);
    res.json({ connections: filtered, lastUpdate, count: filtered.length });
  });

  app.get('/api/processes', (req, res) => {
    try {
      const processes = getAllProcesses();
      res.json({ processes, count: processes.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/processes/summary', (req, res) => {
    try {
      const processes = getProcessSummary();
      res.json({ processes, count: processes.length });
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

  return app;
}