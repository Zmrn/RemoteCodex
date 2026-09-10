import http from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { resolveAgent } from './agents.mjs';

export const deviceFingerprint = a => createHash('sha256').update(JSON.stringify([a.id, a.kind, a.host, a.port, a.sealedKey])).digest('hex');
export function localAddress(host) {
  return Object.values(os.networkInterfaces()).flat().some(n => n?.address.toLowerCase() === host.toLowerCase());
}
export async function notificationRequest(agents, agent, route, body, { resolve = resolveAgent, isLocal = localAddress } = {}) {
  if (agent.kind !== 'remote' || agent.id === 'local') throw Error('Local notifications excluded');
  // Bound key/DNS work as well as the HTTP response; no task writes are retried.
  const deadline = Date.now() + 22000;
  let timer;
  const prepare = Promise.all([resolve(agent.host), agents.key(agent.id)]);
  const [host, key] = await Promise.race([prepare, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Device unavailable')), 12000); })]).finally(() => clearTimeout(timer));
  if (isLocal(host)) throw Object.assign(Error('Local notifications excluded'), { code: 'SELF' });
  if (deviceFingerprint(agents.get(agent.id)) !== deviceFingerprint(agent)) throw Error('Device changed');
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolveResult, reject) => {
    const req = http.request({ hostname: host, port: agent.port, path: '/bridge/v1/api' + route,
      method: payload === null ? 'GET' : 'POST', agent: false,
      headers: { Authorization: 'Bearer ' + key, ...(payload === null ? {} : { 'Content-Type': 'application/json' }) } }, res => {
      let raw = ''; res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) req.destroy(Error('Response too large')); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw Object.assign(Error('Device response unavailable'), { code: res.statusCode === 404 ? 'UNSUPPORTED' : 'HTTP' });
          const value = JSON.parse(raw);
          if (deviceFingerprint(agents.get(agent.id)) !== deviceFingerprint(agent)) throw Error('Device changed');
          resolveResult(value);
        } catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => req.destroy(Error('Device timed out')), Math.max(1, deadline - Date.now()));
    req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end(payload);
  });
}
