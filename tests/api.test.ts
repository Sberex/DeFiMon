import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { isolateProtocol } from '../server/portfolio';
import { networks } from '../server/networks';
import { example } from '../src/example';
let server: Server;
let base: string;
let reads = 0;
const chains: string[] = [];
beforeAll(async () => {
  server = createApp(async (_wallet, network) => { reads++; chains.push(network); return { ...example, chain: networks[network].name, protocols: example.protocols.filter(p => networks[network].protocolIds.includes(p.id)) }; }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
it('rejects invalid addresses before reading the chain', async () => {
  const before = reads;
  for (const address of ['not-a-wallet', '0x0000000000000000000000000000000000000000']) {
    const response = await fetch(`${base}/api/portfolio/${address}`);
    expect(response.status).toBe(400);
  }
  expect(reads).toBe(before);
});
it('serves the reader response with no-store caching', async () => {
  const response = await fetch(`${base}/api/portfolio/${example.address}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).protocols).toHaveLength(5);
});
it('returns health and configuration presence without secret values', async () => {
  const response = await fetch(`${base}/api/health`);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(typeof body.ethereumConfigured).toBe('boolean');
});
it('isolates protocol errors without exposing RPC credentials or claiming empty balances', async () => {
  const failed = await isolateProtocol('aave', 'Aave', 'test market', async () => { throw new Error('https://secret-rpc/key-private'); });
  expect(failed.status).toBe('error');
  expect(failed.message).toContain('unknown');
  expect(JSON.stringify(failed)).not.toContain('key-private');
});

it('routes the selected network and rejects unsupported or ambiguous networks before any reads', async () => {
  await fetch(`${base}/api/portfolio/${example.address}?chain=plasma`);
  expect(chains.at(-1)).toBe('plasma');
  await fetch(`${base}/api/portfolio/${example.address}`);
  expect(chains.at(-1)).toBe('ethereum');
  const before = reads;
  for (const query of ['chain=unknown', 'chain=plasma&chain=ethereum', 'chain[network]=plasma']) {
    expect((await fetch(`${base}/api/portfolio/${example.address}?${query}`)).status).toBe(400);
  }
  expect(reads).toBe(before);
});

it('returns both networks grouped by protocol through the combined endpoint', async () => {
  const before = chains.length;
  const response = await fetch(`${base}/api/portfolio/${example.address}?chain=all`);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const data = await response.json();
  expect(data.chain).toBe('Ethereum + Plasma + Arbitrum'); expect(data.blockNumber).toBeNull();
  expect(data.protocols.map((p: any) => `${p.id}:${p.chain}`)).toEqual(['aave-v3:Ethereum', 'aave-v3:Plasma', 'aave-v3:Arbitrum', 'aave-v4:Ethereum', 'morpho:Ethereum', 'morpho:Arbitrum', 'compound:Ethereum', 'compound:Arbitrum', 'fluid:Ethereum', 'fluid:Plasma', 'fluid:Arbitrum']);
  expect(chains.slice(before)).toEqual(['ethereum', 'plasma', 'arbitrum']);
});

it('rejects invalid, unsupported, zero, or excessive extra token contracts before blockchain reads', async () => {
  const before = reads;
  for (const tokens of ['ethereum:not-a-contract', 'solana:0x2222222222222222222222222222222222222222', 'ethereum:0x0000000000000000000000000000000000000000', Array(21).fill('ethereum:0x2222222222222222222222222222222222222222').join(',')]) {
    const response = await fetch(`${base}/api/portfolio/${example.address}?chain=all&tokens=${encodeURIComponent(tokens)}`);
    expect(response.status).toBe(400);
  }
  expect(reads).toBe(before);
});
