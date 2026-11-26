import { discoverMarkets, parseDiscoveryQuery } from './market-discovery.js';
import type { WalletHistoryStore } from './wallet-history-store.js';
import { parseManualPriceInput } from '../src/wallet-history.js';
import { parsePositionAlertInput } from '../src/alert-rules.js';
import type { TestCasesStore } from './test-cases.js';
import type { CookbookStore } from './cookbook-store.js';
import { emptyCookbook } from '../src/cookbook.js';
import { applyMerklApr } from '../src/merkl-rates.js';
import express from 'express';
import { apiCors } from './cors.js';
import { searchMarkets } from './market-search.js';
import type { ComparisonTarget } from '../src/market-comparison.js';
import { getAddress, isAddress, type Address } from 'viem';
import { getCombinedPortfolio, getPortfolio } from './portfolio.js';
import type { ExtraTokens, MerklRewards, NetworkId, Portfolio } from '../src/types.js';
import { isNetworkId } from '../src/networks.js';
import { readMerklRewards, unavailableMerkl } from './merkl.js';
import { networks } from './networks.js';
export function createApp(load: (wallet: Address, network: NetworkId, extraTokens?: ExtraTokens) => Promise<Portfolio> = getPortfolio, loadRewards: (wallet: Address) => Promise<MerklRewards> = readMerklRewards, loadMarkets = searchMarkets, cookbook?: CookbookStore, testCases?: TestCasesStore, history?: WalletHistoryStore, loadDiscovery = discoverMarkets) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/api', apiCors);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ethereumConfigured: Boolean(process.env.ETHEREUM_RPC_URL), plasmaConfigured: Boolean(process.env.PLASMA_RPC_URL || networks.plasma.defaultRpc), arbitrumConfigured: Boolean(process.env.ARBITRUM_RPC_URL || networks.arbitrum.defaultRpc), baseConfigured: Boolean(process.env.BASE_RPC_URL || networks.base.defaultRpc), bscConfigured: Boolean(process.env.BSC_RPC_URL || networks.bsc.defaultRpc) }));
  app.get('/api/cookbook', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(cookbook ? await cookbook.read() : { data: emptyCookbook(), persistence: { mode: 'local', synced: true } }); }
    catch { res.status(503).json({ error: 'Cookbook snapshots are unavailable. Existing data has not been changed.' }); }
  });
  // Share the native rewards lookup used by the dashboard and Cookbook APRs.
  const rewardRequests = new Map<string, { until: number; value: Promise<MerklRewards> }>();
  function rewardsFor(wallet: Address) {
    const key = wallet.toLowerCase(), existing = rewardRequests.get(key);
    if (existing && existing.until > Date.now()) return existing.value;
    for (const [key, value] of rewardRequests) if (value.until < Date.now()) rewardRequests.delete(key);
    const value = loadRewards(wallet).catch(() => unavailableMerkl(wallet));
    rewardRequests.set(key, { until: Date.now() + 30000, value }); return value;
  }
  // Bound concurrent work. Qualifying lending snapshots are saved to Cookbook.
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
    try { res.json(await rewardsFor(address)); }
    catch { res.json(unavailableMerkl(address)); }
    finally { activeRewards--; }
  });
  let activeMarkets = 0;
  const discoveryCache = new Map<string,{until:number;value:ReturnType<typeof discoverMarkets>}>();
  app.post('/api/market-discovery', express.json({limit:'2kb'}), async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    let query;try { if(Object.keys(req.query).length)throw Error();query=parseDiscoveryQuery(req.body); }
    catch {res.status(400).json({error:'Choose a configured Supply asset and Borrow asset, or Any asset.'});return;}
    for(const [key,entry] of discoveryCache)if(entry.until<Date.now())discoveryCache.delete(key);
    const key=JSON.stringify(query),cached=discoveryCache.get(key);
    if(cached&&cached.until>Date.now()){try{res.json(await cached.value);}catch{res.status(503).json({error:'Market discovery is unavailable. Please retry.'});}return;}
    if(activeMarkets>=2){res.setHeader('Retry-After','10');res.status(429).json({error:'Market searches are busy. Try again shortly.'});return;}
    activeMarkets++;
    const entry={until:Number.POSITIVE_INFINITY,value:Promise.resolve().then(()=>loadDiscovery(query))};
    if(discoveryCache.size>=8){const oldest=[...discoveryCache].find(([,value])=>Number.isFinite(value.until));if(oldest)discoveryCache.delete(oldest[0]);}
    discoveryCache.set(key,entry);
    try{const result=await entry.value;entry.until=Date.now()+60000;res.json(result);}
    catch{discoveryCache.delete(key);res.status(503).json({error:'Market discovery is unavailable. Please retry.'});}
    finally{activeMarkets--;}
  });
  app.post('/api/recommendations', express.json({ limit: '96kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const targets = req.body?.targets;
    if (!req.body || Object.keys(req.body).some(k => k !== 'targets') || !Array.isArray(targets) || !targets.length || targets.length > 40 || targets.some(t => !t || typeof t !== 'object' || Object.keys(t).some(k => !['id', 'network', 'supplied', 'borrowed', 'supplyBasket', 'borrowBasket'].includes(k)) || ['supplyBasket', 'borrowBasket'].some(k => t[k] !== undefined && (!Array.isArray(t[k]) || t[k].length > 20 || t[k].some((a: unknown) => typeof a !== 'string' || !isAddress(a, { strict: false }) || /^0x0{40}$/i.test(a)))) || typeof t.id !== 'string' || t.id.length > 240 || !t.id.length || !isNetworkId(t.network) || typeof t.supplied !== 'string' || !isAddress(t.supplied ?? '', { strict: false }) || /^0x0{40}$/i.test(t.supplied) || (t.borrowed !== undefined && (typeof t.borrowed !== 'string' || !isAddress(t.borrowed, { strict: false }) || /^0x0{40}$/i.test(t.borrowed)))) || new Set(targets.map(t => t.id)).size !== targets.length) {
      res.status(400).json({ error: 'Provide between 1 and 40 unique asset-pair targets with valid networks and token contract addresses.' }); return;
    }
    if (activeMarkets >= 2) { res.setHeader('Retry-After', '10'); res.status(429).json({ error: 'Market searches are busy. Try again shortly.' }); return; }
    activeMarkets++;
    try { res.json(await loadMarkets(targets as ComparisonTarget[])); }
    catch { res.status(503).json({ error: 'Market search is unavailable. Current wallet balances are unchanged.' }); }
    finally { activeMarkets--; }
  });
  let activeHistoryWrites = 0;
  const validHistoryWallet = (address: string) => isAddress(address, { strict: true }) && !/^0x0{40}$/i.test(address);
  app.get('/api/wallet-history/:address', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!validHistoryWallet(req.params.address) || Object.keys(req.query).length) { res.status(400).json({ error: 'Enter a valid wallet address without extra parameters.' }); return; }
    if (!history) { res.status(503).json({ error: 'Wallet history is not configured on this server.' }); return; }
    try { res.json(await history.readWallet(getAddress(req.params.address))); }
    catch { res.status(503).json({ error: 'Saved wallet parameters are unavailable. Existing records have not been replaced.' }); }
  });
  app.post('/api/wallet-history/:address/liquidation-prices', express.json({ limit: '16kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let input;
    try {
      if (!validHistoryWallet(req.params.address) || Object.keys(req.query).length) throw new Error();
      input = parseManualPriceInput(req.body);
    } catch { res.status(400).json({ error: 'Provide a valid wallet, network, protocol, position ID and collateral contract prices in USD (zero or greater).' }); return; }
    if (!history) { res.status(503).json({ error: 'Wallet history is not configured on this server.' }); return; }
    if (activeHistoryWrites >= 2) { res.setHeader('Retry-After', '5'); res.status(429).json({ error: 'Saving prices is busy. Press Calculate again shortly.' }); return; }
    activeHistoryWrites++;
    try { res.json(await history.savePrices(getAddress(req.params.address), input)); }
    catch { res.status(503).json({ error: 'Collateral price assumptions could not be saved. Your calculation is still available; press Calculate to retry.' }); }
    finally { activeHistoryWrites--; }
  });
  app.post('/api/wallet-history/:address/alerts', express.json({ limit: '16kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let input;
    try {
      if (!validHistoryWallet(req.params.address) || Object.keys(req.query).length) throw new Error();
      input = parsePositionAlertInput(req.body);
    } catch { res.status(400).json({ error: 'Provide a valid position and alert rules. Utilization must be 0–100%; enabled percentage rules require a threshold.' }); return; }
    if (!history) { res.status(503).json({ error: 'Wallet history is not configured on this server.' }); return; }
    if (activeHistoryWrites >= 2) { res.setHeader('Retry-After', '5'); res.status(429).json({ error: 'Saving preferences is busy. Press Save alerts again shortly.' }); return; }
    activeHistoryWrites++;
    try { res.json(await history.saveAlerts(getAddress(req.params.address), input)); }
    catch { res.status(503).json({ error: 'Alert preferences could not be saved. Your selections are still available; press Save alerts to retry.' }); }
    finally { activeHistoryWrites--; }
  });
  app.get('/api/portfolio/:address', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const network = req.query.chain ?? 'ethereum';
    if (Object.keys(req.query).some(key => key !== 'chain' && key !== 'tokens') || (!isNetworkId(network) && network !== 'all')) {
      res.status(400).json({ error: 'Choose a supported blockchain: ethereum, plasma, arbitrum, base, or all.' }); return;
    }
    const extraTokens: ExtraTokens = {};
    if (req.query.tokens !== undefined) {
      if (typeof req.query.tokens !== 'string' || req.query.tokens.length > 2000) { res.status(400).json({ error: 'Add no more than 20 token contracts per search.' }); return; }
      const entries = req.query.tokens ? req.query.tokens.split(',') : [];
      if (entries.length > 20) { res.status(400).json({ error: 'Add no more than 20 token contracts per search.' }); return; }
      for (const entry of entries) {
        const [chain, token, extra] = entry.split(':');
        if (!isNetworkId(chain) || extra !== undefined || !isAddress(token ?? '', { strict: false }) || /^0x0{40}$/i.test(token)) {
          res.status(400).json({ error: 'Each added token needs an Ethereum, Plasma, Arbitrum, Base or Binance Smart Chain network and a valid token contract address.' }); return;
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
    const historySnapshot = history?.recordCheck(getAddress(req.params.address)).catch(() => ({ wallet: null, persistence: { mode: 'github' as const, synced: false, message: 'Wallet history could not be loaded or saved. Existing records have not been replaced.' } }));
    try {
      const rewardsSnapshot = cookbook ? rewardsFor(getAddress(req.params.address)) : null;
      const portfolio = network === 'all' ? await getCombinedPortfolio(req.params.address as Address, load, extraTokens) : await load(req.params.address as Address, network, extraTokens);
      if (cookbook) {
        try { await cookbook.record(applyMerklApr(portfolio, await rewardsSnapshot).portfolio); }
        catch { res.setHeader('X-Cookbook-Save', 'unavailable'); }
      }
      if (testCases) {
        try { await testCases.record(portfolio); }
        catch { res.setHeader('X-Test-Cases-Save', 'unavailable'); }
      }
      const saved = await historySnapshot;
      res.json(saved ? { ...portfolio, walletHistory: saved } : portfolio);
    }
    catch {
      if (network === 'all') { res.status(503).json({ error: 'Could not complete the wallet lookup. Please refresh and try again.' }); return; }
      const config = networks[network];
      res.status(503).json({ error: process.env[config.rpcVariable] || config.defaultRpc ? `${config.name} data is unavailable. Check the server’s mainnet provider connection and try again.` : `Live data needs an ${config.name} provider connection. Set ${config.rpcVariable} on the server; no wallet connection is needed.` });
    } finally { await historySnapshot; active--; }
  });
  return app;
}
