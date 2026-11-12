import express from 'express';
import { isAddress, type Address } from 'viem';
import { getPortfolio } from './portfolio.js';
import type { Portfolio } from '../src/types.js';
export function createApp(load: (wallet: Address) => Promise<Portfolio> = getPortfolio) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ethereumConfigured: Boolean(process.env.ETHEREUM_RPC_URL) }));
  // Bound concurrent work; wallet addresses and results are not stored or logged.
  let active = 0;
  app.get('/api/portfolio/:address', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAddress(req.params.address, { strict: true }) || /^0x0{40}$/i.test(req.params.address)) {
      res.status(400).json({ error: 'Enter a valid Ethereum wallet address (0x followed by 40 characters). The zero address is not a wallet.' }); return;
    }
    if (active >= 5) { res.setHeader('Retry-After', '10'); res.status(429).json({ error: 'The monitor is busy. Please try again shortly.' }); return; }
    active++;
    try { res.json(await load(req.params.address as Address)); }
    catch {
      res.status(503).json({ error: process.env.ETHEREUM_RPC_URL ? 'Ethereum data is unavailable. Check the server’s mainnet provider connection and try again.' : 'Live data needs an Ethereum provider connection. Set ETHEREUM_RPC_URL on the server; no wallet connection is needed.' });
    } finally { active--; }
  });
  return app;
}
