import type { Asset, MerklAprQuote, MerklOpportunity, MerklRewards, Portfolio, Position, ProtocolResult } from './types';
const chainIds = { Ethereum: 1, Plasma: 9745, Arbitrum: 42161 };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export interface MerklMatch { id: string; positions: number }
export interface MerklUnapplied { id: string; name: string; reason: string }
export interface MerklMatchResult { portfolio: Portfolio; matches: MerklMatch[]; unapplied: MerklUnapplied[] }
function add(asset: Asset, side: 'LEND' | 'BORROW', opportunity: MerklOpportunity, appliedApr: number, note: string) {
  if (!Number.isFinite(appliedApr) || appliedApr < 0) throw new Error('Invalid rebate');
  const key = side === 'LEND' ? 'merklSupplyRate' : 'merklBorrowRate';
  const previous = asset[key];
  const components = [...(previous?.components ?? []), { id: opportunity.id, name: opportunity.name, listedApr: opportunity.apr, appliedApr, note }];
  const apr = components.reduce((sum, c) => sum + c.appliedApr, 0);
  if (!Number.isFinite(apr)) throw new Error('Invalid combined rebate');
  asset[key] = { apr, estimated: true, note: 'Estimated Merkl incentives, paid separately from protocol interest. Headline rates, eligibility, caps and future earnings can change.', components } satisfies MerklAprQuote;
}
const sideAssets = (p: Position, side: 'LEND' | 'BORROW') => p.assets.filter(a => (side === 'LEND' ? a.supplied : a.borrowed) > 0);
function fluid(protocol: ProtocolResult, op: MerklOpportunity): Set<Position> {
  if (op.rules?.kind !== 'fluid-vault' || protocol.id !== 'fluid') return new Set();
  const vault = op.rules.vault;
  const positions = protocol.positions.filter(p => p.marketAddress && same(p.marketAddress, vault) && !p.id.startsWith('fluid-lending-'));
  const candidates = positions.filter(p => {
    const assets = sideAssets(p, op.action === 'LEND' ? 'LEND' : 'BORROW');
    return assets.length > 0 && assets.length === op.tokens.length && assets.every(a => op.tokens.some(t => same(t, a.address)));
  });
  for (const p of candidates) for (const a of sideAssets(p, op.action === 'LEND' ? 'LEND' : 'BORROW')) add(a, op.action === 'LEND' ? 'LEND' : 'BORROW', op, op.apr, 'Applies only to this vault and this lending side. The same APR on each pool leg allocates one side-wide reward budget across its USD value; it does not duplicate the pool reward.');
  return new Set(candidates);
}
function aaveNetBorrow(protocol: ProtocolResult, op: MerklOpportunity): Set<Position> {
  if (op.rules?.kind !== 'aave-v4-net-borrow' || protocol.id !== 'aave-v4') return new Set();
  if (protocol.status !== 'ok') throw new Error('Aave v4 coverage is incomplete; offsetting supplies may be missing.');
  const rules = op.rules;
  const eligible: { position: Position; asset: Asset; borrowed: number }[] = [];
  let borrowUsd = 0, suppliedUsd = 0;
  for (const position of protocol.positions) for (const asset of position.assets) {
    const relevantToken = rules.hubs.some(h => [...h.borrowAssets, ...h.supplyAssets].some(t => same(t.token, asset.address)));
    if (!relevantToken) continue;
    if (!asset.v4Reserves?.length) throw new Error('Aave hub/reserve balances needed for net-borrowing eligibility are missing.');
    if (asset.v4Reserves.some(r => !Number.isFinite(r.supplied) || !Number.isFinite(r.borrowed) || r.supplied < 0 || r.borrowed < 0)) throw new Error('Aave reserve balances are invalid.');
    const sumSupply = asset.v4Reserves.reduce((s, r) => s + r.supplied, 0), sumBorrow = asset.v4Reserves.reduce((s, r) => s + r.borrowed, 0);
    if (Math.abs(sumSupply - asset.supplied) > Math.max(1e-9, asset.supplied * 1e-9) || Math.abs(sumBorrow - asset.borrowed) > Math.max(1e-9, asset.borrowed * 1e-9)) throw new Error('Aave reserve exposures do not reconcile with balances.');
    let matchedDebt = 0;
    for (const reserve of asset.v4Reserves) {
      const hub = rules.hubs.find(h => same(h.address, reserve.hub)); if (!hub) continue;
      const borrowing = hub.borrowAssets.some(a => a.id === reserve.assetId && same(a.token, asset.address));
      const supplying = hub.supplyAssets.some(a => a.id === reserve.assetId && same(a.token, asset.address));
      if ((borrowing && reserve.borrowed > 0) || (supplying && reserve.supplied > 0)) {
        if (asset.priceUsd === null || !Number.isFinite(asset.priceUsd) || asset.priceUsd <= 0) throw new Error('A qualifying Aave supply or borrowing USD price is unavailable.');
        if (borrowing) { borrowUsd += reserve.borrowed * asset.priceUsd; matchedDebt += reserve.borrowed; }
        if (supplying) suppliedUsd += reserve.supplied * asset.priceUsd;
      }
    }
    if (matchedDebt > 0) eligible.push({ position, asset, borrowed: matchedDebt });
  }
  if (!borrowUsd) return new Set();
  const factor = Math.max(0, borrowUsd - suppliedUsd) / borrowUsd;
  if (!Number.isFinite(factor) || factor > 1) throw new Error('Aave net-borrowing valuation is unavailable.');
  for (const entry of eligible) add(entry.asset, 'BORROW', op, op.apr * factor * entry.borrowed / entry.asset.borrowed, `Headline ${(op.apr * 100).toFixed(2)}% applies to net borrowing after eligible stablecoin supplies across the listed hubs. Estimated eligible share: ${(factor * 100).toFixed(2)}%. Allocated proportionally across matching debt; current balances approximate the campaign’s time-weighted score.`);
  return new Set(eligible.map(e => e.position));
}
export function applyMerklApr(portfolio: Portfolio, rewards: MerklRewards | null): MerklMatchResult {
  if (!rewards || !same(portfolio.address, rewards.address) || !rewards.opportunities?.length) return { portfolio, matches: [], unapplied: [] };
  const result = structuredClone(portfolio);
  // Reapplying a response must never compound the same reward APR.
  result.protocols.forEach(p => p.positions.forEach(p => p.assets.forEach(a => { delete a.merklSupplyRate; delete a.merklBorrowRate; })));
  const matches: MerklMatch[] = [], unapplied: MerklUnapplied[] = [], seen = new Set<string>();
  const counts = new Map<string, number>(); rewards.opportunities.forEach(o => counts.set(o.id, (counts.get(o.id) ?? 0) + 1));
  for (const opportunity of rewards.opportunities) {
    if (counts.get(opportunity.id)! > 1) { if (!seen.has(opportunity.id)) unapplied.push({ id: opportunity.id, name: opportunity.name, reason: 'Duplicate opportunity identity could not be verified.' }); seen.add(opportunity.id); continue; }
    if (seen.has(opportunity.id)) { unapplied.push({ id: opportunity.id, name: opportunity.name, reason: 'Duplicate opportunity was not counted twice.' }); continue; }
    seen.add(opportunity.id);
    if (opportunity.status !== 'ready' || !opportunity.rules) { unapplied.push({ id: opportunity.id, name: opportunity.name, reason: opportunity.reason ?? 'Campaign rules could not be verified.' }); continue; }
    const protocols = result.protocols.filter(p => {
      const chain = p.chain ?? (portfolio.chain in chainIds ? portfolio.chain as keyof typeof chainIds : undefined);
      return chain && chainIds[chain] === opportunity.chainId && ['ok', 'partial'].includes(p.status) && ((p.id === 'fluid' && opportunity.protocol === 'fluid') || (p.id === 'aave-v4' && opportunity.protocol === 'aave'));
    });
    const previous = structuredClone(result.protocols);
    try {
      const matched = new Set<Position>();
      for (const protocol of protocols) {
        const rows = opportunity.rules.kind === 'fluid-vault' ? fluid(protocol, opportunity) : aaveNetBorrow(protocol, opportunity);
        rows.forEach(p => matched.add(p));
      }
      if (matched.size) matches.push({ id: opportunity.id, positions: matched.size });
      else unapplied.push({ id: opportunity.id, name: opportunity.name, reason: 'No matching checked position, vault, hub, asset and lending side was found on this network.' });
    } catch (error) {
      result.protocols = previous;
      // Matching failures contain only our fixed public explanations, never provider/API errors.
      unapplied.push({ id: opportunity.id, name: opportunity.name, reason: error instanceof Error ? error.message : 'The position could not be verified.' });
    }
  }
  return { portfolio: result, matches, unapplied };
}
