import { createApp, setConnections } from './api.js';
import { getAllConnections } from './powershell.js';
import { startCapture, stopCapture, getTrafficByFlow, clearTrafficByFlow, listDevices } from './capture.js';
import { correlateTrafficWithConnections } from './correlate.js';

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);
const DEVICE = process.env.CAPTURE_DEVICE || null;

const app = createApp();

async function pollConnections() {
  try {
    const trafficByFlow = getTrafficByFlow();
    clearTrafficByFlow();

    const enrichedConnections = await correlateTrafficWithConnections(trafficByFlow);
    setConnections(enrichedConnections);
    
    const totalSent = enrichedConnections.reduce((sum, c) => sum + (c.bytesSent || 0), 0);
    const totalRecv = enrichedConnections.reduce((sum, c) => sum + (c.bytesRecv || 0), 0);
    console.log(`[${new Date().toISOString()}] Polled ${enrichedConnections.length} connections | Total: ↑${totalSent} ↓${totalRecv} bytes`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Poll error:`, err.message);
  }
}

async function start() {
  console.log('Starting Stage B: Packet capture + PID correlation...');
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  console.log('\nAvailable capture devices:');
  for (const dev of listDevices()) {
    const marker = dev.name === DEVICE ? ' ← SELECTED' : '';
    console.log(`  ${dev.description} (${dev.name})${marker}`);
  }

  if (!DEVICE) {
    console.log('\nNo CAPTURE_DEVICE specified, using Cap.findDevice() default');
  }

  try {
    startCapture(DEVICE);
  } catch (err) {
    console.error('[Capture] Failed to start:', err.message);
    console.log('Continuing without packet capture (Stage A mode only)');
  }

  await pollConnections();
  setInterval(pollConnections, POLL_INTERVAL_MS);

  app.listen(PORT, () => {
    console.log(`\nAPI listening on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET /health');
    console.log('  GET /api/connections  (now includes bytesSent/bytesRecv)');
    console.log('  GET /api/connections/:pid');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopCapture();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  stopCapture();
  process.exit(1);
});