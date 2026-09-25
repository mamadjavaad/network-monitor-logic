import {
  insertAlert,
  hasRecentAlert,
  isKnownEndpoint,
  recordEndpoint,
  countKnownEndpoints,
  getRecentTrafficSamplesForPid,
  getDistinctActivePids,
  getProcessNameByPid,
} from './db.js';


function checkNewDestinations(connections, now) {
  for (const c of connections) {
    if (!c.remoteAddress || c.remoteAddress === '—' || c.protocol !== 'TCP') continue;
    const state = c.stateName || c.state;
    if (state !== 'ESTABLISHED') continue;
    if (!c.processName) continue;

    if (isKnownEndpoint(c.processName, c.remoteAddress, c.remotePort)) continue;

    recordEndpoint(c.processName, c.remoteAddress, c.remotePort, now);
    const endpointCount = countKnownEndpoints(c.processName);
    if (endpointCount <= 1) continue; 

    if (hasRecentAlert('new_destination', c.processName)) continue;
    insertAlert({
      type: 'new_destination',
      severity: 'medium',
      pid: c.pid,
      processName: c.processName,
      title: 'مقصد جدید شناسایی شد',
      description: `${c.processName} به آدرس جدید ${c.remoteAddress}:${c.remotePort} متصل شد`,
    });
  }
}

function checkHighTraffic({ multiplier = 5, minBytes = 500_000, lookback = 20 } = {}) {
  const activePids = getDistinctActivePids(5);

  for (const pid of activePids) {
    const samples = getRecentTrafficSamplesForPid(pid, lookback);
    if (samples.length < 6) continue; 

    const [latest, ...history] = samples;
    const processName = getProcessNameByPid(pid);

    for (const [type, field, label] of [
      ['high_download', 'bytes_recv', 'دانلود'],
      ['high_upload', 'bytes_sent', 'آپلود'],
    ]) {
      const latestValue = latest[field];
      const avg = history.reduce((s, r) => s + r[field], 0) / history.length;

      if (latestValue < minBytes) continue;
      if (avg <= 0 || latestValue < avg * multiplier) continue;
      if (hasRecentAlert(type, processName)) continue;

      insertAlert({
        type,
        severity: 'high',
        pid,
        processName,
        title: `${label} غیرعادی شناسایی شد`,
        description: `${processName} در یک بازه ${Math.round(latestValue / 1024)} کیلوبایت ${label} داشت که حدود ${multiplier} برابر میانگین اخیر آن است`,
      });
    }
  }
}


function checkConnectionBursts(connections, { threshold = 15 } = {}) {
  const counts = new Map();
  for (const c of connections) {
    if (!c.processName) continue;
    counts.set(c.processName, (counts.get(c.processName) || 0) + 1);
  }

  for (const [processName, count] of counts) {
    if (count < threshold) continue;
    if (hasRecentAlert('connection_burst', processName)) continue;

    insertAlert({
      type: 'connection_burst',
      severity: 'medium',
      pid: null,
      processName,
      title: 'افزایش ناگهانی ارتباطات',
      description: `${processName} در حال حاضر ${count} ارتباط همزمان باز دارد`,
    });
  }
}


export function runAlertChecks(connections, now) {
  try { checkNewDestinations(connections, now); } catch (err) { console.error('[Alerts] new_destination check failed:', err.message); }
  try { checkHighTraffic(); } catch (err) { console.error('[Alerts] high_download/high_upload check failed:', err.message); }
  try { checkConnectionBursts(connections); } catch (err) { console.error('[Alerts] connection_burst check failed:', err.message); }
}
