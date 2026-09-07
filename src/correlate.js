import { getAllConnections } from './powershell.js';

function normalizeIp(ip) {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '');
}

function makeConnectionKey(conn) {
  const localIp = normalizeIp(conn.localAddress);
  const remoteIp = normalizeIp(conn.remoteAddress);
  return `${conn.protocol}:${localIp}:${conn.localPort}-${remoteIp}:${conn.remotePort}`;
}

function makeFlowKey(protocol, localIp, localPort, remoteIp, remotePort) {
  return `${protocol}:${normalizeIp(localIp)}:${localPort}-${normalizeIp(remoteIp)}:${remotePort}`;
}

export async function correlateTrafficWithConnections(trafficByFlow) {
  const connections = await getAllConnections();
  
  const connMap = new Map();
  for (const conn of connections) {
    const key = makeConnectionKey(conn);
    connMap.set(key, conn);
  }

  const enriched = [];
  const seenFlows = new Set();

  for (const [flowKey, traffic] of trafficByFlow) {
    const match = connMap.get(flowKey);
    if (match) {
      enriched.push({
        ...match,
        bytesSent: traffic.sent,
        bytesRecv: traffic.recv,
      });
      seenFlows.add(flowKey);
    }
  }

  for (const conn of connections) {
    const key = makeConnectionKey(conn);
    if (!seenFlows.has(key)) {
      enriched.push({
        ...conn,
        bytesSent: 0,
        bytesRecv: 0,
      });
    }
  }

  return enriched;
}