import capModule from 'cap';
const Cap = capModule.Cap;
const decoders = capModule.decoders;
const PROTOCOL = decoders.PROTOCOL;

const ETHERNET_TYPES = PROTOCOL.ETHERNET;
const IP_PROTOCOLS = PROTOCOL.IP;

let trafficByFlow = new Map();
let captureInstance = null;
let selectedDevice = null;

function normalizeIp(ip) {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '');
}

function makeFlowKey(localIp, localPort, remoteIp, remotePort, protocol) {
  const l = `${normalizeIp(localIp)}:${localPort}`;
  const r = `${normalizeIp(remoteIp)}:${remotePort}`;
  return `${protocol}:${l}-${r}`;
}

function decodePacket(nbytes, buffer) {
  const eth = decoders.Ethernet(buffer);
  if (eth.info.type !== ETHERNET_TYPES.IPV4) return;

  const ip = decoders.IPV4(buffer, eth.offset);
  const protocol = ip.info.protocol;
  let srcPort = 0;
  let dstPort = 0;

  if (protocol === IP_PROTOCOLS.TCP) {
    const tcp = decoders.TCP(buffer, ip.offset);
    srcPort = tcp.info.srcport;
    dstPort = tcp.info.dstport;
  } else if (protocol === IP_PROTOCOLS.UDP) {
    const udp = decoders.UDP(buffer, ip.offset);
    srcPort = udp.info.srcport;
    dstPort = udp.info.dstport;
  } else {
    return;
  }

  const srcIp = ip.info.srcaddr;
  const dstIp = ip.info.dstaddr;

  const keyOut = makeFlowKey(srcIp, srcPort, dstIp, dstPort, protocol === IP_PROTOCOLS.TCP ? 'TCP' : 'UDP');
  const keyIn = makeFlowKey(dstIp, dstPort, srcIp, srcPort, protocol === IP_PROTOCOLS.TCP ? 'TCP' : 'UDP');

  const existingOut = trafficByFlow.get(keyOut) || { sent: 0, recv: 0 };
  existingOut.sent += nbytes;
  trafficByFlow.set(keyOut, existingOut);

  const existingIn = trafficByFlow.get(keyIn) || { sent: 0, recv: 0 };
  existingIn.recv += nbytes;
  trafficByFlow.set(keyIn, existingIn);
}

export function listDevices() {
  return Cap.deviceList();
}

export function startCapture(deviceName = null) {
  if (captureInstance) {
    console.log('[Capture] Already running');
    return;
  }

  const device = deviceName || Cap.findDevice();
  if (!device) {
    throw new Error('No capture device found. Run listDevices() to see available interfaces.');
  }

  selectedDevice = device;
  console.log(`[Capture] Starting on device: ${device}`);

  const buffer = Buffer.alloc(65535);

  captureInstance = new Cap();
  captureInstance.open(device, '', 10 * 1024 * 1024, buffer);

  captureInstance.on('packet', (nbytes) => {
    decodePacket(nbytes, buffer);
  });

  console.log('[Capture] Packet capture started');
}

export function stopCapture() {
  if (captureInstance) {
    captureInstance.close();
    captureInstance = null;
    console.log('[Capture] Stopped');
  }
}

export function getTrafficByFlow() {
  return new Map(trafficByFlow);
}

export function clearTrafficByFlow() {
  trafficByFlow.clear();
}

export function getSelectedDevice() {
  return selectedDevice;
}