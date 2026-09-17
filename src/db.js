import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'network-monitor.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processes (
      pid INTEGER PRIMARY KEY,
      process_name TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      local_addr TEXT,
      local_port INTEGER,
      remote_addr TEXT,
      remote_port INTEGER,
      state TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS traffic_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pid INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      bytes_sent INTEGER NOT NULL,
      bytes_recv INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_connections_pid ON connections(pid);
    CREATE INDEX IF NOT EXISTS idx_connections_open ON connections(closed_at) WHERE closed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_traffic_pid ON traffic_samples(pid);
    CREATE INDEX IF NOT EXISTS idx_traffic_time ON traffic_samples(timestamp);
  `);
}

let previousConnections = new Map();

function makeConnKey(c) {
  return `${c.protocol}:${c.localAddress || c.local_addr}:${c.localPort || c.local_port}-${c.remoteAddress || c.remote_addr}:${c.remotePort || c.remote_port}`;
}

export function upsertProcesses(connections, now) {
  const stmt = getDb().prepare(`
    INSERT INTO processes (pid, process_name, first_seen, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(pid) DO UPDATE SET
      process_name = excluded.process_name,
      last_seen = excluded.last_seen
  `);

  const seen = new Set();
  for (const c of connections) {
    if (seen.has(c.pid) || !c.pid) continue;
    seen.add(c.pid);
    stmt.run(c.pid, c.processName || c.process_name || `PID:${c.pid}`, now, now);
  }
}

export function diffAndStoreConnections(connections, now) {
  const insertConn = getDb().prepare(`
    INSERT INTO connections (pid, protocol, local_addr, local_port, remote_addr, remote_port, state, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const closeConn = getDb().prepare(`
    UPDATE connections SET closed_at = ?, last_seen = ? WHERE id = ?
  `);

  const touchConn = getDb().prepare(`
    UPDATE connections SET last_seen = ? WHERE id = ?
  `);

  const currentSnapshot = new Map();
  for (const c of connections) {
    currentSnapshot.set(makeConnKey(c), c);
  }

  const insertMany = getDb().transaction(() => {
    for (const [key, conn] of currentSnapshot) {
      const prevConn = previousConnections.get(key);
      if (!prevConn) {
        insertConn.run(
          conn.pid, conn.protocol,
          conn.localAddress || conn.local_addr, conn.localPort || conn.local_port,
          conn.remoteAddress || conn.remote_addr, conn.remotePort || conn.remote_port,
          conn.stateName || conn.state,
          now, now
        );
      } else {
        const prevState = prevConn.stateName || prevConn.state;
        const currState = conn.stateName || conn.state;
        if (prevState !== currState) {
          closeConn.run(now, now, prevConn._dbId);
          insertConn.run(
            conn.pid, conn.protocol,
            conn.localAddress || conn.local_addr, conn.localPort || conn.local_port,
            conn.remoteAddress || conn.remote_addr, conn.remotePort || conn.remote_port,
            currState,
            now, now
          );
        } else {
          touchConn.run(now, prevConn._dbId);
        }
      }
    }

    for (const [key, prevConn] of previousConnections) {
      if (!currentSnapshot.has(key)) {
        closeConn.run(now, now, prevConn._dbId);
      }
    }
  });

  insertMany();
  loadOpenConnections(currentSnapshot);
}

function loadOpenConnections(snapshot) {
  const rows = getDb().prepare(`
    SELECT id, pid, protocol, local_addr, local_port, remote_addr, remote_port, state
    FROM connections WHERE closed_at IS NULL
  `).all();

  const loaded = new Map();
  for (const row of rows) {
    const key = `${row.protocol}:${row.local_addr}:${row.local_port}-${row.remote_addr}:${row.remote_port}`;
    const fromSnapshot = snapshot.get(key);
    loaded.set(key, {
      pid: row.pid,
      protocol: row.protocol,
      localAddress: row.local_addr,
      localPort: row.local_port,
      remoteAddress: row.remote_addr,
      remotePort: row.remote_port,
      state: row.state,
      _dbId: row.id,
    });
  }
  previousConnections = loaded;
}

export function insertTrafficSamples(connections, now) {
  const stmt = getDb().prepare(`
    INSERT INTO traffic_samples (pid, timestamp, bytes_sent, bytes_recv)
    VALUES (?, ?, ?, ?)
  `);

  const byPid = new Map();
  for (const c of connections) {
    if (!c.pid) continue;
    const existing = byPid.get(c.pid) || { bytesSent: 0, bytesRecv: 0 };
    existing.bytesSent += c.bytesSent || 0;
    existing.bytesRecv += c.bytesRecv || 0;
    byPid.set(c.pid, existing);
  }

  const insertMany = getDb().transaction(() => {
    for (const [pid, traffic] of byPid) {
      stmt.run(pid, now, traffic.bytesSent, traffic.bytesRecv);
    }
  });

  insertMany();
}

export function getTrafficHistory(pid, { since, until } = {}) {
  let sql = 'SELECT * FROM traffic_samples WHERE pid = ?';
  const params = [pid];
  if (since) { sql += ' AND timestamp >= ?'; params.push(since); }
  if (until) { sql += ' AND timestamp <= ?'; params.push(until); }
  sql += ' ORDER BY timestamp ASC';
  return getDb().prepare(sql).all(...params);
}

export function getAllProcesses() {
  return getDb().prepare('SELECT * FROM processes ORDER BY last_seen DESC').all();
}

export function getProcessSummary({ activeWithinSeconds = 15 } = {}) {
  const cutoff = new Date(Date.now() - activeWithinSeconds * 1000).toISOString();
  return getDb().prepare(`
    SELECT
      p.pid,
      p.process_name,
      p.last_seen,
      COALESCE(SUM(s.bytes_sent), 0) as total_sent,
      COALESCE(SUM(s.bytes_recv), 0) as total_recv,
      (SELECT COUNT(*) FROM connections c WHERE c.pid = p.pid AND c.closed_at IS NULL) as active_connections
    FROM processes p
    LEFT JOIN traffic_samples s ON s.pid = p.pid
    WHERE p.last_seen >= ?
    GROUP BY p.pid
    ORDER BY (total_sent + total_recv) DESC
  `).all(cutoff);
}

export function getTrafficTimeline({ minutes = 30 } = {}) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT
      substr(timestamp, 1, 16) as bucket,
      SUM(bytes_sent) as sent,
      SUM(bytes_recv) as recv
    FROM traffic_samples
    WHERE timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(since);
}

export function cleanupOldProcesses(hours = 48) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const result = getDb().prepare('DELETE FROM processes WHERE last_seen < ?').run(cutoff);
  return result.changes;
}

export function cleanupOldSamples(hours = 48) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const result = getDb().prepare('DELETE FROM traffic_samples WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}