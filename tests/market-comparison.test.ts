import { expect, it } from 'vitest';
import { betterAlternatives, groupAlternativesByLiquidity, comparisonTargets, type MarketAlternative, type MarketSearch } from '../src/market-comparison';
import { recommendationPositions } from '../src/recommendations';
import { correspondingTokens } from '../server/market-tokens';
import { example } from '../src/example';
const position = () => {
  const p = recommendationPositions(structuredClone(example).protocols)[0];
  p.market = '0x1111111111111111111111111111111111111111';
  p.rows[0].supplied!.address = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
  p.rows[0].borrowed!.address = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f';
  return p;
};
const candidate = (targetId: string, changes: Partial<MarketAlternative> = {}): MarketAlternative => ({ targetId, protocol: 'Morpho', network: 'arbitrum', market: '0x2222222222222222222222222222222222222222', label: 'Test market', supplyApr: 0, borrowApr: .03, lltv: .8, block: '100', url: 'https://app.morpho.org/', note: '', ...changes });
const search = (alternatives: MarketAlternative[]): MarketSearch => ({ checkedAt: '', coverage: [], alternatives });
it('groups only known liquidity below the borrowed token amount, preserving order and equality', () => {
  const list = [2000, 1000, 999, 0, undefined, NaN, -1].map((amount, i) => candidate('target', { market: String(i), liquidity: amount === undefined ? null : { amount, symbol: 'USDC', token: 'matched-debt-token', note: '' } }));
  const result = groupAlternativesByLiquidity(list, 1000);
  expect(result.visible.map(c => c.market)).toEqual(['0', '1', '4', '5', '6']);
  expect(result.insufficient.map(c => c.market)).toEqual(['2', '3']);
  expect(list).toHaveLength(7);
  for (const borrowed of [undefined, 0, NaN]) expect(groupAlternativesByLiquidity(list, borrowed)).toEqual({ visible: list, insufficient: [] });
});
it('matches the user-configured cross-network addresses, including USDT0, while excluding unlisted assets', () => {
  expect(correspondingTokens('0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', 'ethereum', 'arbitrum')).toEqual(['0x5979d7b546e38e414f7e9822514be443a4800529']);
  expect(correspondingTokens('0x0000000000000000000000000000000000001234', 'ethereum', 'arbitrum')).toEqual([]);
  expect(correspondingTokens('0xdac17f958d2ee523a2206206994597c13d831ec7', 'ethereum', 'plasma')).toEqual(['0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb']);
});
it('ranks strictly lower borrowing rates for the requested pair, excluding equal, unknown and current markets', () => {
  const p = position(), id = comparisonTargets([p])[0].id;
  const result = betterAlternatives(p, 0, search([
    candidate(id), candidate(id, { market: 'other', borrowApr: .02 }), candidate(id, { market: 'equal', borrowApr: .055 }),
    candidate(id, { protocol: p.protocol, network: 'ethereum', market: p.market!, borrowApr: .01 }), candidate('wrong-pair', { borrowApr: .001 }), candidate(id, { market: 'unknown', borrowApr: null }),
  ]));
  expect(result.map(c => c.comparedApr)).toEqual([.02, .03]);
  expect(result[0].difference).toBeCloseTo(.035);
});
it('uses current net Merkl borrowing costs rather than overstating savings against the base rate', () => {
  const p = position(); p.rows[0].borrowed!.merklBorrowRate = { apr: .03, note: '', components: [] };
  const id = comparisonTargets([p])[0].id;
  expect(betterAlternatives(p, 0, search([candidate(id)]) )).toEqual([]);
  expect(betterAlternatives(p, 0, search([candidate(id, { borrowApr: -.01 })]))[0].difference).toBeCloseTo(.035);
});
it('compares supply alternatives with intrinsic yield once and current Merkl rewards, without double counting', () => {
  const p = position(); p.rows[0].borrowed = undefined; p.vault = true;
  p.rows[0].supplied!.supplyRate = { apr: .03, note: '' };
  p.rows[0].supplied!.intrinsicSupplyRate = { apr: .07, note: '', source: { chain: 'Ethereum', oracle: 'feed' } };
  p.rows[0].supplied!.merklSupplyRate = { apr: .01, note: '', components: [] };
  const id = comparisonTargets([p])[0].id;
  const result = betterAlternatives(p, 0, search([candidate(id, { supplyApr: .05, borrowApr: null })]));
  expect(result[0].comparedApr).toBeCloseTo(.12); expect(result[0].difference).toBeCloseTo(.01);
  p.rows[0].supplied!.intrinsicSupplyRate.apr = null;
  expect(betterAlternatives(p, 0, search([candidate(id, { supplyApr: .5, borrowApr: null })]))).toEqual([]);
});
it('does not construct an unverified token target or rank against an unknown current rate', () => {
  const p = position(); p.rows[0].supplied!.address = '';
  expect(comparisonTargets([p])).toEqual([]);
  p.rows[0].borrowed!.borrowRate = undefined;
  expect(betterAlternatives(p, 0, search([candidate(`${p.key}:0`)]))).toEqual([]);
});
it('distinguishes Aave v4 hub routes within one Spoke and excludes only the held route', () => {
  const p = position(); p.protocol = 'Aave v4'; p.protocolId = 'aave-v4';
  p.rows[0].supplied!.v4Reserves = [{ hub: 'hub', assetId: '1', supplied: 10, borrowed: 0 }];
  p.rows[0].borrowed!.v4Reserves = [{ hub: 'hub', assetId: '2', supplied: 0, borrowed: 100 }];
  const id = comparisonTargets([p])[0].id;
  const result = betterAlternatives(p, 0, search([
    candidate(id, { protocol: 'Aave v4', network: 'ethereum', market: p.market!, route: 'hub/1:hub/2', borrowApr: .02 }),
    candidate(id, { protocol: 'Aave v4', network: 'ethereum', market: p.market!, route: 'hub/3:hub/4', borrowApr: .03 }),
  ]));
  expect(result).toHaveLength(1); expect(result[0].route).toBe('hub/3:hub/4');
});
it('sorts borrowing alternatives by descending liquidity, keeps zero above unknown, and uses APR only for ties', () => {
  const p = position(), id = comparisonTargets([p])[0].id;
  const liquidity = (amount: number) => ({ amount, symbol: 'GHO', token: p.rows[0].borrowed!.address, note: '' });
  const result = betterAlternatives(p, 0, search([
    candidate(id, { market: 'unknown', borrowApr: .001 }),
    candidate(id, { market: 'smaller', borrowApr: .02, liquidity: liquidity(100) }),
    candidate(id, { market: 'largest', borrowApr: .04, liquidity: liquidity(1000) }),
    candidate(id, { market: 'zero', borrowApr: .03, liquidity: liquidity(0) }),
    candidate(id, { market: 'same-liquidity-cheaper', borrowApr: .03, liquidity: liquidity(1000) }),
    candidate(id, { market: 'invalid', borrowApr: .002, liquidity: liquidity(NaN) }),
  ]));
  expect(result.map(c => c.market)).toEqual(['same-liquidity-cheaper', 'largest', 'smaller', 'zero', 'unknown', 'invalid']);
});

it('compares Euler APR against current APR while preserving its separately labeled compounded APY', () => {
  const p = position();
  p.rows[0].borrowed!.borrowRate = { apr: .0707, note: 'Current APR' };
  const id = comparisonTargets([p])[0].id;
  const result = betterAlternatives(p, 0, search([candidate(id, { protocol: 'Euler', borrowApr: .0693, borrowApy: .0718 })]));
  expect(result).toHaveLength(1);
  expect(result[0].comparedApr).toBe(.0693);
  expect(result[0].difference).toBeCloseTo(.0014);
  expect(result[0].borrowApy).toBe(.0718);
});

it('keeps Base positions and alternatives on Base and expands verified USDC to Base', () => {
  const p = position(); p.chain = 'Base';
  expect(comparisonTargets([p])[0].network).toBe('base');
  expect(correspondingTokens('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'ethereum', 'base')).toEqual(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913']);
  p.market = '0x2222222222222222222222222222222222222222';
  const id = comparisonTargets([p])[0].id;
  expect(betterAlternatives(p, 0, search([candidate(id, { protocol: p.protocol, network: 'base', market: p.market, borrowApr: .01 })]))).toEqual([]);
});
