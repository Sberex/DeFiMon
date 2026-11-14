import express from 'express';
import { getAddress, isAddress, type Address } from 'viem';
import { getCombinedPortfolio, getPortfolio } from './portfolio.js';
import type { ExtraTokens, MerklRewards, NetworkId, Portfolio } from '../src/types.js';
import { isNetworkId } from '../src/networks.js';
import { readMerklRewards, unavailableMerkl } from './merkl.js';
import { networks } from './networks.js';
export function createApp(load: (wallet: Address, network: NetworkId, extraTokens?: ExtraTokens) => Promise<Portfolio> = getPortfolio, loadRewards: (wallet: Address) => Promise<MerklRewards> = readMerklRewards) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ethereumConfigured: Boolean(process.env.ETHEREUM_RPC_URL), plasmaConfigured: Boolean(process.env.PLASMA_RPC_URL || networks.plasma.defaultRpc), arbitrumConfigured: Boolean(process.env.ARBITRUM_RPC_URL || networks.arbitrum.defaultRpc) }));
  // Bound concurrent work; wallet addresses and results are not stored or logged.
  let active = 0;
  let activeRewards = 0;
  app.get('/api/rewards/:address', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (Object.keys(req.query).length || !isAddress(req.params.address, { strict: true }) || /^0x0{40}$/i.test(req.params.address)) {
      res.status(400).json({ error: 'Enter a valid wallet address. Reward lookups do not accept extra parameters.' }); return;
    }
    if (activeRewards >= 5) { res.setHeader('Retry-After', '10'); res.status(429).json({ error: 'Reward lookups are busy. Please refresh shortly.' }); return; }
    activeRewards++;
    const address = getAddress(req.params.address);
    try { res.json(await loadRewards(address)); }
    catch { res.json(unavailableMerkl(address)); }
    finally { activeRewards--; }
  });
  app.get('/api/portfolio/:address', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const network = req.query.chain ?? 'ethereum';
    if (Object.keys(req.query).some(key => key !== 'chain' && key !== 'tokens') || (!isNetworkId(network) && network !== 'all')) {
      res.status(400).json({ error: 'Choose a supported blockchain: ethereum, plasma, arbitrum, or all.' }); return;
    }
    const extraTokens: ExtraTokens = {};
    if (req.query.tokens !== undefined) {
      if (typeof req.query.tokens !== 'string' || req.query.tokens.length > 2000) { res.status(400).json({ error: 'Add no more than 20 token contracts per search.' }); return; }
      const entries = req.query.tokens ? req.query.tokens.split(',') : [];
      if (entries.length > 20) { res.status(400).json({ error: 'Add no more than 20 token contracts per search.' }); return; }
      for (const entry of entries) {
        const [chain, token, extra] = entry.split(':');
        if (!isNetworkId(chain) || extra !== undefined || !isAddress(token ?? '', { strict: false }) || /^0x0{40}$/i.test(token)) {
          res.status(400).json({ error: 'Each added token needs an Ethereum, Plasma, or Arbitrum network and a valid token contract address.' }); return;
        }
        const address = getAddress(token.toLowerCase());
        extraTokens[chain] = [...new Set([...(extraTokens[chain] ?? []), address])];
      }
    }
    if (!isAddress(req.params.address, { strict: true }) || /^0x0{40}$/i.test(req.params.address)) {
      res.status(400).json({ error: 'Enter a valid wallet address (0x followed by 40 characters). The zero address is not a wallet.' }); return;
    }
    if (active >= 5) { res.setHeader('Retry-After', '10'); res.status(429).json({ error: 'The monitor is busy. Please try again shortly.' }); return; }
    active++;
    try { res.json(network === 'all' ? await getCombinedPortfolio(req.params.address as Address, load, extraTokens) : await load(req.params.address as Address, network, extraTokens)); }
    catch {
      if (network === 'all') { res.status(503).json({ error: 'Could not complete the wallet lookup. Please refresh and try again.' }); return; }
      const config = networks[network];
      res.status(503).json({ error: process.env[config.rpcVariable] || config.defaultRpc ? `${config.name} data is unavailable. Check the server’s mainnet provider connection and try again.` : `Live data needs an ${config.name} provider connection. Set ${config.rpcVariable} on the server; no wallet connection is needed.` });
    } finally { active--; }
  });
  return app;
}
