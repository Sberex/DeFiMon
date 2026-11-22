import { expect, it } from 'vitest';
import { cookbookPositions, emptyCookbook, mergeCookbooks, parseCookbook, updateCookbook } from '../src/cookbook';
import { snapshot } from './fixtures/cookbook';

it('uses leveraged net-value APR, including intrinsic yield and incentives, with an exclusive 14% threshold', () => {
  expect(cookbookPositions(updateCookbook(emptyCookbook(), snapshot(.14)))).toEqual([]);
  const portfolio = snapshot(.12); const asset = portfolio.protocols[0].positions[0].assets[0];
  asset.intrinsicSupplyRate = { apr: .02, note: '', source: { chain: 'Ethereum', oracle: '' } };
  asset.merklSupplyRate = { apr: .01, note: '', components: [] };
  const data = updateCookbook(emptyCookbook(), portfolio), row = cookbookPositions(data)[0];
  expect(row.apr).toBeCloseTo(.18); expect(row.monthlyNplUsd).toBeCloseTo(7.5); expect(row.netValueUsd).toBe(500);
  expect(row).toMatchObject({ address: portfolio.address, snapshotAt: portfolio.updatedAt, blockNumber: '123', verification: 'verified' });
  expect(parseCookbook(data)).toEqual(data); expect(portfolio.protocols[0].positions[0].assets[0].intrinsicSupplyRate).toBeDefined();
});
it('replaces snapshots for the same address, removes vanished and below-threshold positions, and retains other wallets', () => {
  const a = snapshot(), b = snapshot(.3, a.updatedAt, '0x4444444444444444444444444444444444444444');
  let data = updateCookbook(updateCookbook(emptyCookbook(), a), b);
  const fresh = snapshot(.25, '2026-11-20T11:00:00.000Z');
  data = updateCookbook(data, fresh);
  expect(cookbookPositions(data)).toHaveLength(2);
  expect(cookbookPositions(data).find(p => p.address === a.address)?.snapshotAt).toBe(fresh.updatedAt);
  fresh.updatedAt = '2026-11-20T12:00:00.000Z'; fresh.protocols[0].positions = [];
  data = updateCookbook(data, fresh);
  expect(cookbookPositions(data).map(p => p.address)).toEqual([b.address]);
  data = updateCookbook(data, snapshot(.1, '2026-11-20T13:00:00.000Z', b.address));
  expect(cookbookPositions(data)).toEqual([]);
});
it('does not delete confirmed snapshots when discovery, balances or interest inputs are unreadable', () => {
  const original = snapshot(), first = updateCookbook(emptyCookbook(), original);
  for (const failure of ['network', 'position', 'rate'] as const) {
    const failed = snapshot(.2, '2026-11-20T11:00:00.000Z'); failed.blockNumber = '124';
    if (failure === 'network') { failed.protocols[0].status = 'error'; failed.protocols[0].positions = []; }
    if (failure === 'position') { failed.protocols[0].status = 'partial'; failed.protocols[0].positions[0].assets = []; failed.protocols[0].positions[0].suppliedUsd = null; }
    if (failure === 'rate') failed.protocols[0].positions[0].assets[0].supplyRate = { apr: null, note: '' };
    const rows = cookbookPositions(updateCookbook(first, failed));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ snapshotAt: original.updatedAt, blockNumber: '123', verification: 'unavailable' });
  }
});
it('excludes Bad Debt and does not turn unknown or zero net value into a qualifying APR', () => {
  const file = updateCookbook(emptyCookbook(), snapshot());
  const bad = snapshot(.8, '2026-11-20T12:00:00.000Z');
  bad.protocols[0].positions[0].collateralOracleChecks = [{ asset: 'Collateral', oracle: '', status: 'zero' }];
  expect(cookbookPositions(updateCookbook(file, bad))).toEqual([]);
  bad.protocols[0].positions[0].collateralOracleChecks = [];
  bad.protocols[0].positions[0].suppliedUsd = 500;
  expect(cookbookPositions(updateCookbook(file, bad))).toEqual([]);
});
it('preserves deletion tombstones and rejects older responses without merging unrelated networks away', () => {
  const old = updateCookbook(emptyCookbook(), snapshot());
  const closed = snapshot(.2, '2026-11-20T12:00:00.000Z'); closed.protocols[0].positions = [];
  const newest = updateCookbook(old, closed);
  expect(cookbookPositions(mergeCookbooks(old, newest))).toEqual([]);
  expect(cookbookPositions(mergeCookbooks(newest, old))).toEqual([]);
  expect(cookbookPositions(updateCookbook(newest, snapshot()))).toEqual([]);
  const arb = snapshot(.3, '2026-11-20T13:00:00.000Z'); arb.chain = 'Arbitrum';
  expect(cookbookPositions(updateCookbook(newest, arb))[0].chain).toBe('Arbitrum');
});
it('rejects malformed and duplicate Cookbook records', () => {
  expect(() => parseCookbook({})).toThrow();
  const file = updateCookbook(emptyCookbook(), snapshot());
  file.wallets.push(file.wallets[0]); expect(() => parseCookbook(file)).toThrow();
});

it('does not let a slower response from an older block resurrect a removed position', () => {
  const original = updateCookbook(emptyCookbook(), snapshot());
  const closed = snapshot(.2, '2026-11-20T11:00:00.000Z'); closed.blockNumber = '125'; closed.protocols[0].positions = [];
  const current = updateCookbook(original, closed);
  const delayed = snapshot(.4, '2026-11-20T12:00:00.000Z'); delayed.blockNumber = '124';
  expect(cookbookPositions(updateCookbook(current, delayed))).toEqual([]);
  expect(cookbookPositions(mergeCookbooks(current, updateCookbook(emptyCookbook(), delayed)))).toEqual([]);
});

it('lists unique supplied contracts by chain with latest intrinsic rates, PT appreciation and no lending-rate substitution', async () => {
  const { cookbookSuppliedAssets } = await import('../src/cookbook');
  const first = snapshot(.3), latest = snapshot(.4, '2026-11-20T11:00:00.000Z', '0x4444444444444444444444444444444444444444');
  const a = first.protocols[0].positions[0].assets[0];
  a.intrinsicSupplyRate = { apr: .08, note: '', source: { chain: 'Ethereum', oracle: '' } };
  const b = latest.protocols[0].positions[0].assets[0];
  b.address = b.address.toUpperCase().replace('0X', '0x');
  b.intrinsicSupplyRate = { apr: -.02, note: '', source: { chain: 'Ethereum', oracle: '' } };
  let saved = updateCookbook(updateCookbook(emptyCookbook(), first), latest);
  const entry = structuredClone(cookbookPositions(saved).find(x => x.address === latest.address)!);
  const base = structuredClone(entry); base.chain = 'Base';
  const pt = structuredClone(a); pt.address = '0x5555555555555555555555555555555555555555';
  pt.supplyRate = { apr: .15, note: '', pendlePt: { network: 'ethereum', marketAddress: null, expiry: null, updatedAt: null } };
  // PT metadata wins over a stale underlying intrinsic field; zero-balance rows
  // and borrowed-only USDC never become collateral-list items.
  const plain = { ...a, address: '0x6666666666666666666666666666666666666666', intrinsicSupplyRate: undefined };
  const unknown = { ...a, address: '0x7777777777777777777777777777777777777777', intrinsicSupplyRate: { ...a.intrinsicSupplyRate, apr: null } };
  entry.position.assets.push(pt, plain, unknown, { ...a, address: '0x8888888888888888888888888888888888888888', supplied: 0 });
  const rows = cookbookSuppliedAssets([...cookbookPositions(saved), entry, base]);
  expect(rows).toHaveLength(5);
  expect(rows.find(x => x.chain === 'Ethereum' && x.address === a.address)?.intrinsicApr).toBe(-.02);
  expect(rows.find(x => x.address === pt.address)?.intrinsicApr).toBe(.15);
  expect(rows.find(x => x.address === plain.address)?.intrinsicApr).toBe(0);
  expect(rows.find(x => x.address === unknown.address)?.intrinsicApr).toBeNull();
  expect(rows.filter(x => x.address === a.address)).toHaveLength(2);
  const closed = snapshot(.4, '2026-11-20T12:00:00.000Z', latest.address); closed.protocols[0].positions = [];
  saved = updateCookbook(saved, closed);
  expect(cookbookSuppliedAssets(cookbookPositions(saved))).toMatchObject([{ intrinsicApr: .08 }]);
});

it('groups configured cross-chain contracts, preserves network rates and sorts intrinsic APR descending with unknowns last', async () => {
  const { cookbookSuppliedAssets } = await import('../src/cookbook');
  const { configuredTokenRegistry } = await import('../server/token-registry');
  const template = cookbookPositions(updateCookbook(emptyCookbook(), snapshot(.3)))[0];
  function entry(chain: typeof template.chain, contract: string, apr: number | null, time = '2026-11-20T10:00:00.000Z') {
    const row = structuredClone(template); row.chain = chain; row.snapshotAt = time;
    row.position.assets = [{ ...row.position.assets[0], address: contract.toUpperCase().replace('0X', '0x'), symbol: 'Same ticker', intrinsicSupplyRate: { apr, note: '', source: { chain, oracle: '' } } }];
    return row;
  }
  const susdai = configuredTokenRegistry.sUSDai.addresses, usdc = configuredTokenRegistry.USDC.addresses;
  const unknown = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const entries = [
    entry('Ethereum', susdai.ethereum!, .08, '2026-11-20T12:00:00.000Z'),
    entry('Arbitrum', susdai.arbitrum!, .079), entry('Plasma', susdai.plasma!, .081),
    entry('Ethereum', usdc.ethereum!, .10), entry('Arbitrum', usdc.arbitrum!, .09, '2026-11-20T11:00:00.000Z'),
    entry('Ethereum', unknown, .20), entry('Base', unknown, .03),
    entry('Ethereum', '0x5555555555555555555555555555555555555555', 0),
    entry('Ethereum', '0x6666666666666666666666666666666666666666', -.01),
    entry('Ethereum', '0x7777777777777777777777777777777777777777', null),
  ];
  const rows = cookbookSuppliedAssets(entries);
  expect(rows).toHaveLength(7);
  expect(rows.map(x => x.intrinsicApr)).toEqual([.20, .09, .08, .03, 0, -.01, null]);
  const grouped = rows.find(x => x.address === susdai.ethereum)!;
  expect(grouped.chain).toBe('Ethereum');
  expect(grouped.additionalNetworks.map(x => [x.chain, x.intrinsicApr])).toEqual([['Arbitrum', .079], ['Plasma', .081]]);
  const stable = rows.find(x => x.id === 'configured:USDC')!;
  expect(stable.chain).toBe('Arbitrum'); expect(stable.additionalNetworks[0].address).toBe(usdc.ethereum);
  expect(rows.filter(x => x.address === unknown)).toHaveLength(2);
  expect(cookbookSuppliedAssets(entries.filter(x => x.chain !== 'Ethereum')).find(x => x.id === grouped.id)?.additionalNetworks).toHaveLength(1);
});
