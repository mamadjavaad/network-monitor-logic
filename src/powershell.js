import { spawn } from 'child_process';

const TCP_STATE_MAP = {
  1: 'CLOSED',
  2: 'LISTEN',
  3: 'SYN_SENT',
  4: 'SYN_RCVD',
  5: 'ESTABLISHED',
  6: 'FIN_WAIT1',
  7: 'FIN_WAIT2',
  8: 'CLOSE_WAIT',
  9: 'CLOSING',
  10: 'LAST_ACK',
  11: 'TIME_WAIT',
  12: 'DELETE_TCB',
  100: 'BOUND',
};

const PS_TCP_CMD = `Get-NetTCPConnection | Select-Object State, LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess | ConvertTo-Json -Depth 3`;
const PS_UDP_CMD = `Get-NetUDPEndpoint | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess | ConvertTo-Json -Depth 3`;
const PS_PROCESS_CMD = (pids) => `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id, ProcessName | ConvertTo-Json -Depth 2`;

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (data) => (stdout += data.toString()));
    ps.stderr.on('data', (data) => (stderr += data.toString()));
    ps.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
    ps.on('error', reject);
  });
}

function parseJsonSafe(output) {
  if (!output) return [];
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export async function getTcpConnections() {
  const output = await runPowerShell(PS_TCP_CMD);
  return parseJsonSafe(output).map((c) => ({
    protocol: 'TCP',
    state: c.State,
    stateName: TCP_STATE_MAP[c.State] || `UNKNOWN(${c.State})`,
    localAddress: c.LocalAddress,
    localPort: c.LocalPort,
    remoteAddress: c.RemoteAddress,
    remotePort: c.RemotePort,
    pid: c.OwningProcess,
  }));
}

export async function getUdpEndpoints() {
  const output = await runPowerShell(PS_UDP_CMD);
  return parseJsonSafe(output).map((c) => ({
    protocol: 'UDP',
    state: 'N/A',
    localAddress: c.LocalAddress,
    localPort: c.LocalPort,
    remoteAddress: c.RemoteAddress,
    remotePort: c.RemotePort,
    pid: c.OwningProcess,
  }));
}

export async function getProcessNames(pids) {
  const uniquePids = [...new Set(pids.filter((p) => p > 0))];
  if (uniquePids.length === 0) return new Map();
  const output = await runPowerShell(PS_PROCESS_CMD(uniquePids));
  const processes = parseJsonSafe(output);
  const map = new Map();
  for (const p of processes) {
    map.set(p.Id, p.ProcessName);
  }
  return map;
}

export async function getAllConnections() {
  const [tcp, udp] = await Promise.all([getTcpConnections(), getUdpEndpoints()]);
  const all = [...tcp, ...udp];
  const pidSet = new Set(all.map((c) => c.pid).filter((p) => p > 0));
  const processNames = await getProcessNames([...pidSet]);
  return all.map((c) => ({
    ...c,
    processName: processNames.get(c.pid) || `PID:${c.pid}`,
  }));
}