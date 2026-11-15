import { expect, it } from 'vitest';
import { betterAlternatives, comparisonTargets, type MarketAlternative, type MarketSearch } from '../src/market-comparison';
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
it('matches reviewed cross-network addresses, preserving distinct wrappers and unlisted assets', () => {
  expect(correspondingTokens('0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', 'ethereum', 'arbitrum')).toEqual(['0x5979d7b546e38e414f7e9822514be443a4800529']);
  expect(correspondingTokens('0x0000000000000000000000000000000000001234', 'ethereum', 'arbitrum')).toEqual([]);
  expect(correspondingTokens('0xdac17f958d2ee523a2206206994597c13d831ec7', 'ethereum', 'plasma')).not.toContain('0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb');
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
