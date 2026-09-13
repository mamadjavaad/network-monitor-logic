import { spawn } from 'child_process';
import capModule from 'cap';
const Cap = capModule.Cap;

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d.toString()));
    ps.stderr.on('data', (d) => (stderr += d.toString()));
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });
    ps.on('error', reject);
  });
}
const PS_BEST_ROUTE_CMD = `Find-NetRoute -RemoteIPAddress "8.8.8.8" | Where-Object { $_.IPAddress } | Select-Object -First 1 -Property IPAddress, InterfaceAlias | ConvertTo-Json`;

export async function getDefaultCaptureDevice() {
  const output = await runPowerShell(PS_BEST_ROUTE_CMD);
  if (!output) {
    throw new Error('Find-NetRoute returned no result');
  }

  const best = JSON.parse(output);
  const localIp = best.IPAddress;
  if (!localIp) {
    throw new Error('Could not determine local IP for the active route');
  }

  const devices = Cap.deviceList();
  const match = devices.find((d) =>
    (d.addresses || []).some((a) => a.addr === localIp)
  );

  if (!match) {
    throw new Error(
      `No capture device found matching IP ${localIp} (interface: ${best.InterfaceAlias})`
    );
  }

  console.log(`[NetworkDetect] Active interface: ${best.InterfaceAlias} (${localIp}) -> ${match.name}`);
  return match.name;
}