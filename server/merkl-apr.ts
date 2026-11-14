import { getAddress, isAddress, type Address } from 'viem';
import type { MerklOpportunity, MerklRewards } from '../src/types.js';
const API = 'https://api.merkl.xyz/v4';
type Obj = Record<string, unknown>;
function object(value: unknown): Obj { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Merkl APR data'); return value as Obj; }
function address(value: unknown): string {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) throw new Error('Invalid campaign address');
  return getAddress(value.toLowerCase());
}
function array(value: unknown, limit = 100): unknown[] { if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid campaign list'); return value; }
function id(value: unknown): string { if (typeof value !== 'string' || !/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new Error('Invalid asset ID'); return String(Number(value)); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function parseMerklOpportunity(value: unknown): MerklOpportunity | null {
  const o = object(object(value).opportunity);
  if (!Number.isSafeInteger(o.chainId)) throw new Error('Invalid opportunity chain');
  if (![1, 9745, 42161].includes(Number(o.chainId))) return null;
  if (typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(o.id) || typeof o.type !== 'string' || typeof o.identifier !== 'string' || o.identifier.length > 256 || typeof o.apr !== 'number' || !Number.isFinite(o.apr) || o.apr < 0) throw new Error('Invalid opportunity rate');
  const protocol = object(o.protocol).id;
  if (typeof protocol !== 'string') throw new Error('Missing protocol identity');
  const tokens = array(o.tokens).map(value => { const t = object(value); if (t.chainId !== o.chainId || t.type !== 'TOKEN' || t.isTest === true) throw new Error('Invalid underlying token'); return address(t.address); });
  if (!tokens.length || new Set(tokens.map(t => t.toLowerCase())).size !== tokens.length) throw new Error('Invalid token set');
  const action = o.action === 'BORROW' || o.action === 'LEND' ? o.action : 'OTHER';
  const result: MerklOpportunity = { id: o.id, type: o.type, chainId: Number(o.chainId), protocol: protocol.toLowerCase(), action, identifier: o.identifier, name: typeof o.name === 'string' ? o.name.slice(0, 500) : o.type, tokens, apr: o.apr / 100, status: 'unsupported', reason: 'Campaign rules are not supported for automatic position matching.' };
  if (o.status !== 'LIVE') { result.reason = 'This opportunity is not live.'; return result; }
  if (protocol.toLowerCase() === 'fluid' && ((o.type === 'FLUIDVAULT_BORROW' && action === 'BORROW') || (o.type === 'FLUIDVAULT_COLLATERAL' && action === 'LEND'))) {
    const vault = address(o.identifier);
    if (o.explorerAddress !== undefined && !same(address(o.explorerAddress), vault)) throw new Error('Conflicting vault identity');
    return { ...result, rules: { kind: 'fluid-vault', vault } };
  }
  return result;
}
export function resolveMerklRules(opportunity: MerklOpportunity, value: unknown, wallet: Address, now = Date.now() / 1000): MerklOpportunity {
  try {
    const detail = object(value);
    if (detail.id !== opportunity.id || detail.type !== opportunity.type || detail.chainId !== opportunity.chainId || detail.identifier !== opportunity.identifier) throw new Error('Opportunity identity mismatch');
    const campaigns = array(detail.campaigns, 1000).map(object).filter(c => Number(c.startTimestamp) <= now && Number(c.endTimestamp) > now);
    if (!campaigns.length) throw new Error('No currently active campaign rules were returned.');
    let rules: MerklOpportunity['rules'];
    for (const campaign of campaigns) {
      if (campaign.opportunityId !== opportunity.id || campaign.computeChainId !== opportunity.chainId || campaign.type !== opportunity.type || campaign.isPrivate === true || campaign.hasOverrides === true) throw new Error('Campaign identity or private eligibility cannot be verified.');
      const reward = object(campaign.rewardToken);
      if (reward.type !== 'TOKEN' || reward.isTest === true) throw new Error('Non-token incentives cannot be included as earned interest.');
      const p = object(campaign.params);
      if ((campaign.subType !== undefined && campaign.subType !== null && campaign.subType !== 0) || (opportunity.type === 'AAVE_V4_HUB_NET_BORROWING' && object(p.computeScoreParameters).computeMethod !== 'genericTimeWeighted') || (p.computeScoreParameters !== undefined && object(p.computeScoreParameters).computeMethod !== 'genericTimeWeighted')) throw new Error('The campaign uses an unsupported score or subtype.');
      for (const key of ['hooks', 'forwarders', 'forwardingList']) if (p[key] !== undefined && array(p[key]).length) throw new Error('Custom hooks or forwarded-account eligibility is not supported.');
      const blacklist = p.blacklist === undefined ? [] : array(p.blacklist).map(address);
      const whitelist = p.whitelist === undefined ? [] : array(p.whitelist).map(address);
      if (blacklist.some(a => same(a, wallet)) || (whitelist.length && !whitelist.some(a => same(a, wallet)))) throw new Error('This wallet is excluded by the current campaign rules.');
      if (opportunity.rules?.kind === 'fluid-vault') { rules = opportunity.rules; continue; }
      const hubs = array(p.hubs, 32).map(value => {
        const h = object(value), assets = array(h.assets).map(value => { const a = object(value); return { id: id(a.assetId), token: address(a.underlyingToken) }; });
        if (new Set(assets.map(a => a.id)).size !== assets.length) throw new Error('Duplicate asset IDs');
        const selected = (value: unknown) => array(value).map(value => { const key = id(value); const asset = assets.find(a => a.id === key); if (!asset) throw new Error('Missing hub asset identity'); return asset; }).sort((a, b) => Number(a.id) - Number(b.id));
        return { address: address(h.hubAddress), borrowAssets: selected(h.borrowAssetIds), supplyAssets: selected(h.supplyAssetIds) };
      }).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
      if (!hubs.length || hubs.some(h => !h.borrowAssets.length) || new Set(hubs.map(h => h.address.toLowerCase())).size !== hubs.length) throw new Error('Incomplete hub rules');
      if (hubs.some(h => h.borrowAssets.some(a => !opportunity.tokens.some(t => same(t, a.token))))) throw new Error('Borrow token mismatch');
      const current = { kind: 'aave-v4-net-borrow' as const, hubs };
      if (rules && JSON.stringify(rules) !== JSON.stringify(current)) throw new Error('Active campaigns have different eligibility rules.');
      rules = current;
    }
    return { ...opportunity, status: 'ready', reason: undefined, rules };
  } catch (error) {
    const known = error instanceof Error && ['No currently active campaign rules were returned.', 'Campaign identity or private eligibility cannot be verified.', 'The campaign uses an unsupported score or subtype.', 'Non-token incentives cannot be included as earned interest.', 'Custom hooks or forwarded-account eligibility is not supported.', 'This wallet is excluded by the current campaign rules.', 'Active campaigns have different eligibility rules.'].includes(error.message) ? error.message : 'The current campaign rules could not be verified.';
    return { ...opportunity, status: 'unsupported', rules: undefined, reason: known };
  }
}
export async function readMerklApr(wallet: Address, fetcher: typeof fetch = fetch): Promise<Pick<MerklRewards, 'aprStatus' | 'aprMessage' | 'opportunities'>> {
  async function json(path: string) {
    const response = await fetcher(`${API}${path}`, { signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Merkl APR request failed');
    const text = await response.text(); if (text.length > 3000000) throw new Error('Merkl APR response too large'); return JSON.parse(text) as unknown;
  }
  try {
    const values = array(await json(`/users/${getAddress(wallet)}/rewards/active-opportunities`), 1000);
    const opportunities: MerklOpportunity[] = [];
    const seen = new Set<string>(); let incomplete = false;
    for (const value of values) {
      try {
        const op = parseMerklOpportunity(value); if (!op) continue;
        if (seen.has(op.id)) { const previous = opportunities.find(o => o.id === op.id)!; previous.status = 'unsupported'; previous.rules = undefined; previous.reason = 'Duplicate opportunity identity could not be verified.'; throw new Error('Duplicate opportunity'); } seen.add(op.id); opportunities.push(op);
      } catch { incomplete = true; }
    }
    const needsRules = opportunities.filter(o => o.reason !== 'This opportunity is not live.' && o.reason !== 'Duplicate opportunity identity could not be verified.' && (o.rules?.kind === 'fluid-vault' || (o.protocol === 'aave' && o.type === 'AAVE_V4_HUB_NET_BORROWING' && o.action === 'BORROW')));
    for (let start = 0; start < Math.min(needsRules.length, 12); start += 3) {
      await Promise.all(needsRules.slice(start, start + 3).map(async op => {
        try { Object.assign(op, resolveMerklRules(op, await json(`/opportunities/${encodeURIComponent(op.id)}?campaigns=true`), wallet)); }
        catch { op.reason = 'The current campaign rules could not be loaded.'; }
      }));
    }
    needsRules.slice(12).forEach(op => { op.reason = 'Campaign rule lookup limit reached. This opportunity was not applied.'; });
    const partial = incomplete || opportunities.some(o => o.status !== 'ready');
    return { aprStatus: partial ? 'partial' : 'ok', opportunities, aprMessage: incomplete ? 'Some Merkl APR records could not be verified. Only verified matches are applied.' : undefined };
  } catch { return { aprStatus: 'error', opportunities: [], aprMessage: 'Merkl APR lookup is unavailable. Displayed rates and NPL exclude unverified Merkl incentives.' }; }
}
