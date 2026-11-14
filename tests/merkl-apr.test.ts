import { expect, it } from 'vitest';
import { parseMerklOpportunity, readMerklApr, resolveMerklRules } from '../server/merkl-apr';
import { applyMerklApr } from '../src/merkl-rates';
import { assetMonthlyInterest, borrowApr, supplyApr, totalMonthlyInterest } from '../src/monthly-interest';
import { detail, hub, opportunities, portfolio, rawOpportunity, rewards, wallet } from './fixtures/merkl-apr';
it('converts Merkl percentage points to APR fractions and resolves current exact vault/hub rules', () => {
  for (let i = 0; i < 3; i++) {
    const op = parseMerklOpportunity(rawOpportunity(i))!;
    expect(op.apr).toBeCloseTo(opportunities[i].apr);
    const resolved = resolveMerklRules(op, detail(i), wallet);
    expect(resolved.status).toBe('ready'); expect(resolved.rules).toEqual(opportunities[i].rules);
  }
});
it('does not use expired/future rules or a campaign belonging to another opportunity, chain or reward type', () => {
  const op = parseMerklOpportunity(rawOpportunity(0))!;
  for (const changes of [{ endTimestamp: Date.now() / 1000 - 1 }, { startTimestamp: Date.now() / 1000 + 1000 }, { computeChainId: 9745 }, { opportunityId: 'wrong' }, { rewardToken: { type: 'POINT' } }]) {
    const data = detail(0); Object.assign(data.campaigns[0], changes);
    expect(resolveMerklRules(op, data, wallet).status).toBe('unsupported');
  }
});
it('checks whitelist, blacklist, custom hooks, overrides and conflicting active campaign rules', () => {
  const op = parseMerklOpportunity(rawOpportunity(0))!;
  for (const changes of [{ blacklist: [wallet] }, { whitelist: ['0x1111111111111111111111111111111111111111'] }, { hooks: ['custom'] }, { forwarders: [wallet] }, { computeScoreParameters: { computeMethod: 'customBoost' } }]) {
    const data = detail(0); Object.assign(data.campaigns[0].params, changes);
    expect(resolveMerklRules(op, data, wallet).status).toBe('unsupported');
  }
  const data = detail(0); data.campaigns[0].params.whitelist = [wallet] as never[];
  expect(resolveMerklRules(op, data, wallet).status).toBe('ready');
  const conflict = detail(0); conflict.campaigns.push(structuredClone(conflict.campaigns[0])); conflict.campaigns[1].params.hubs[0].supplyAssetIds = ['5'];
  expect(resolveMerklRules(op, conflict, wallet).status).toBe('unsupported');
});
it('matches Fluid supply and borrow sides only to the same vault, network and underlying tokens', () => {
  const p = portfolio(), before = structuredClone(p);
  const adjusted = applyMerklApr(p, rewards());
  const assets = adjusted.portfolio.protocols[1].positions[0].assets;
  expect(supplyApr(assets[0].supplyRate, undefined, assets[0].merklSupplyRate)).toBeCloseTo(.04 + opportunities[2].apr);
  expect(borrowApr(assets[0].borrowRate, assets[0].merklBorrowRate)).toBeCloseTo(.06 - opportunities[1].apr);
  expect(assets.every(a => a.merklSupplyRate?.components.length === 1 && a.merklBorrowRate?.components.length === 1)).toBe(true);
  expect(p).toEqual(before); expect(adjusted.matches).toHaveLength(3);
  expect(adjusted.portfolio.protocols[1].positions[0].healthFactor).toBe(before.protocols[1].positions[0].healthFactor);
});
it('does not apply a same-named token or same vault address on another chain, to another vault, or to the opposite side', () => {
  for (const change of ['chain', 'vault', 'token', 'side']) {
    const p = portfolio(); const fluid = p.protocols[1]; const pos = fluid.positions[0];
    if (change === 'chain') fluid.chain = 'Ethereum';
    if (change === 'vault') pos.marketAddress = '0x1111111111111111111111111111111111111111';
    if (change === 'token') pos.assets[0].address = '0x1111111111111111111111111111111111111111';
    if (change === 'side') { pos.assets.forEach(a => { a.borrowed = 0; }); }
    const result = applyMerklApr(p, rewards());
    expect(result.portfolio.protocols[1].positions[0].assets.every(a => !a.merklBorrowRate)).toBe(true);
    if (change !== 'side') expect(result.portfolio.protocols[1].positions[0].assets.every(a => !a.merklSupplyRate)).toBe(true);
  }
});
it('scales the Aave rebate by net borrowing after eligible stablecoin supplies', () => {
  const result = applyMerklApr(portfolio(), rewards()); const aave = result.portfolio.protocols[0].positions[0].assets;
  expect(aave[0].merklBorrowRate?.apr).toBeCloseTo(.0175 * .6);
  expect(borrowApr(aave[0].borrowRate, aave[0].merklBorrowRate)).toBeCloseTo(.0495);
  expect(aave[1].merklSupplyRate).toBeUndefined();
  expect(assetMonthlyInterest(aave[0]).paidUsd).toBeCloseTo(41.25);
});
it('deducts supplies across separate Aave spokes, caps eligibility at zero and weights a partially eligible merged asset', () => {
  const p = portfolio(), aave = p.protocols[0], pos = aave.positions[0];
  const supply = structuredClone(pos); supply.id = 'other-spoke'; supply.assets = [pos.assets[1]]; pos.assets = [pos.assets[0]]; aave.positions.push(supply);
  expect(applyMerklApr(p, rewards()).portfolio.protocols[0].positions[0].assets[0].merklBorrowRate?.apr).toBeCloseTo(.0175 * .6);
  supply.assets[0].supplied = 12000; supply.assets[0].v4Reserves![0].supplied = 12000;
  expect(applyMerklApr(p, rewards()).portfolio.protocols[0].positions[0].assets[0].merklBorrowRate?.apr).toBe(0);
  supply.assets[0].supplied = 2000; supply.assets[0].v4Reserves![0].supplied = 2000;
  pos.assets[0].v4Reserves = [{ hub, assetId: '5', supplied: 0, borrowed: 5000 }, { hub: '0x1111111111111111111111111111111111111111', assetId: '5', supplied: 0, borrowed: 5000 }];
  expect(applyMerklApr(p, rewards()).portfolio.protocols[0].positions[0].assets[0].merklBorrowRate?.apr).toBeCloseTo(.0175 * .6 * .5);
});
it('withholds Aave rewards when coverage, prices, hub identity or reserve reconciliation is missing', () => {
  for (const change of ['partial', 'metadata', 'price', 'reconcile', 'hub', 'invalid']) {
    const p = portfolio(), aave = p.protocols[0], a = aave.positions[0].assets[0];
    if (change === 'partial') aave.status = 'partial';
    if (change === 'metadata') a.v4Reserves = undefined;
    if (change === 'price') aave.positions[0].assets[1].priceUsd = null;
    if (change === 'reconcile') a.v4Reserves![0].borrowed = 1;
    if (change === 'hub') a.v4Reserves![0].hub = '0x1111111111111111111111111111111111111111';
    if (change === 'invalid') a.v4Reserves![0].borrowed = NaN;
    expect(applyMerklApr(p, rewards()).portfolio.protocols[0].positions[0].assets[0].merklBorrowRate).toBeUndefined();
  }
});
it('never counts the same opportunity twice, compounds a repeated response, or applies another wallet’s APR', () => {
  const p = portfolio(), r = rewards(), first = applyMerklApr(p, r);
  expect(applyMerklApr(first.portfolio, r).portfolio).toEqual(first.portfolio);
  const wrongWallet = { ...r, address: '0x1111111111111111111111111111111111111111' };
  expect(applyMerklApr(p, wrongWallet).portfolio).toEqual(p);
  r.opportunities!.push(structuredClone(r.opportunities![1]));
  expect(applyMerklApr(p, r).portfolio.protocols[1].positions[0].assets.every(a => !a.merklBorrowRate)).toBe(true);
});
it('adds rewards to NPL once per eligible USD balance, including smart-pool legs and negative net borrowing costs', () => {
  const p = portfolio(), before = totalMonthlyInterest(p.protocols), result = applyMerklApr(p, rewards()).portfolio;
  const after = totalMonthlyInterest(result.protocols);
  const expected = 10000 * opportunities[2].apr / 12 + 8000 * opportunities[1].apr / 12 + 6000 * opportunities[0].apr / 12;
  expect(after.nplUsd! - before.nplUsd!).toBeCloseTo(expected);
  expect(result.protocols[1].positions[0].suppliedUsd).toBe(10000);
  result.protocols[1].positions[0].assets[0].borrowRate!.apr = .001;
  expect(borrowApr(result.protocols[1].positions[0].assets[0].borrowRate, result.protocols[1].positions[0].assets[0].merklBorrowRate)).toBeLessThan(0);
});
it('loads live user opportunities and campaign details independently and handles duplicate, malformed and unreachable feeds', async () => {
  const fetcher = (async (url: unknown) => new Response(JSON.stringify(String(url).includes('active-opportunities') ? [rawOpportunity(0), rawOpportunity(1), rawOpportunity(2)] : detail(Number(String(url).includes(opportunities[0].id) ? 0 : String(url).includes(opportunities[1].id) ? 1 : 2))))) as typeof fetch;
  const result = await readMerklApr(wallet, fetcher);
  expect(result.aprStatus).toBe('ok'); expect(result.opportunities).toHaveLength(3); expect(result.opportunities?.every(o => o.status === 'ready')).toBe(true);
  const duplicate = await readMerklApr(wallet, (async () => new Response(JSON.stringify([rawOpportunity(0), rawOpportunity(0)]))) as typeof fetch);
  expect(duplicate.aprStatus).toBe('partial'); expect(duplicate.opportunities![0].status).toBe('unsupported');
  const failed = await readMerklApr(wallet, (async () => { throw new Error('private-provider-secret'); }) as typeof fetch);
  expect(failed.aprStatus).toBe('error'); expect(JSON.stringify(failed)).not.toContain('private-provider-secret');
});
