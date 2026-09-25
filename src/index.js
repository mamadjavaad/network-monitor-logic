import { createApp, setConnections } from './api.js';
import { getAllConnections } from './powershell.js';
import { startCapture, stopCapture, getTrafficByFlow, clearTrafficByFlow, listDevices } from './capture.js';
import { correlateTrafficWithConnections } from './correlate.js';
import {
  upsertProcesses,
  diffAndStoreConnections,
  insertTrafficSamples,
  cleanupOldSamples,
  cleanupOldProcesses,
  cleanupOldAlerts,
  closeDb,
} from './db.js';
import { runAlertChecks } from './alerts.js';

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);
const DEVICE = process.env.CAPTURE_DEVICE || null;
const RETENTION_HOURS = 48;

const app = createApp();

async function pollConnections() {
  try {
    const now = new Date().toISOString();
    const trafficByFlow = getTrafficByFlow();
    clearTrafficByFlow();

    const enrichedConnections = await correlateTrafficWithConnections(trafficByFlow);
    setConnections(enrichedConnections);

    upsertProcesses(enrichedConnections, now);
    diffAndStoreConnections(enrichedConnections, now);
    insertTrafficSamples(enrichedConnections, now);
    runAlertChecks(enrichedConnections, now);

    const totalSent = enrichedConnections.reduce((sum, c) => sum + (c.bytesSent || 0), 0);
    const totalRecv = enrichedConnections.reduce((sum, c) => sum + (c.bytesRecv || 0), 0);
    console.log(`[${now}] Polled ${enrichedConnections.length} connections | Total: ↑${totalSent} ↓${totalRecv} bytes`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll error:`, err.message);
  }
}

async function start() {
  console.log('Starting Stage C: Packet capture + PID correlation + persistence...');
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  console.log('\nAvailable capture devices:');
  for (const dev of listDevices()) {
    const marker = dev.name === DEVICE ? ' ← SELECTED' : '';
    console.log(`  ${dev.description} (${dev.name})${marker}`);
  }

  if (!DEVICE) {
    console.log('\nNo CAPTURE_DEVICE specified, auto-detecting active interface...');
  }

  try {
    await startCapture(DEVICE);
  } catch (err) {
    console.error('[Capture] Failed to start:', err.message);
    console.log('Continuing without packet capture (Stage A mode only)');
  }

  await pollConnections();
  setInterval(pollConnections, POLL_INTERVAL_MS);

  const cleanupInterval = setInterval(() => {
    try {
      const deleted = cleanupOldSamples(RETENTION_HOURS);
      if (deleted > 0) console.log(`[Cleanup] Removed ${deleted} traffic samples older than ${RETENTION_HOURS}h`);
      const deletedProcs = cleanupOldProcesses(RETENTION_HOURS);
      if (deletedProcs > 0) console.log(`[Cleanup] Removed ${deletedProcs} stale processes older than ${RETENTION_HOURS}h`);
      const deletedAlerts = cleanupOldAlerts();
      if (deletedAlerts > 0) console.log(`[Cleanup] Removed ${deletedAlerts} old alerts`);
    } catch (err) {
      console.error('[Cleanup] Error:', err.message);
    }
  }, 3600 * 1000);

  app.listen(PORT, () => {
    console.log(`\nAPI listening on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET /health');
    console.log('  GET /api/connections');
    console.log('  GET /api/connections/:pid');
    console.log('  GET /api/processes');
    console.log('  GET /api/history/:pid?since=&until=');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    clearInterval(cleanupInterval);
    stopCapture();
    closeDb();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  stopCapture();
  closeDb();
  process.exit(1);
});