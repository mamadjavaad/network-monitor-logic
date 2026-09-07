import express from 'express';

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

  return app;
}