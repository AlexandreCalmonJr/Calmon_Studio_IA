import dgram from 'node:dgram';
import os from 'node:os';

export const DISCOVERY_UDP_PORT = 41234;

export function startRemoteDiscoveryBeacon(httpPort: number): { close: () => void } {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let closed = false;

  const buildPayload = () =>
    Buffer.from(
      JSON.stringify({
        service: 'calmon-studio',
        hostname: os.hostname(),
        platform: os.platform(),
        port: httpPort,
        version: process.env.CALMON_APP_VERSION || '3.1.0',
      })
    );

  socket.on('error', () => {
    // Porta UDP ocupada ou bloqueada pelo firewall — degrada silenciosamente
  });

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8').trim();
    if (text === 'CALMON_DISCOVER') {
      const payload = buildPayload();
      socket.send(payload, 0, payload.length, rinfo.port, rinfo.address, () => {});
    }
  });

  try {
    socket.bind(DISCOVERY_UDP_PORT);
  } catch {
    // ignore bind errors
  }

  return {
    close: () => {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
  };
}

