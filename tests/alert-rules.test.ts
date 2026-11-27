import { expect, it } from 'vitest';
import { alertPositions, retainedAlertPositions, defaultAlertRules, parsePositionAlertInput } from '../src/alert-rules';
import { mergeWalletHistory, parseWalletHistory } from '../src/wallet-history';
import { example } from '../src/example';
const address = example.address.toLowerCase(), day = '2026-11-22T10:00:00.000Z', later = '2026-11-22T11:00:00.000Z';
const input = { network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'AAVE-MAIN', rules: defaultAlertRules() };
it('validates all five rules with explicit percent units, zero and negative APR thresholds, and fixed health factor', () => {
  const rules = { ...defaultAlertRules(), borrowAprAboveSupplyApr: true, newLiquidityAdded: true, utilizationAbove: { enabled: true, thresholdPercent: 0 }, healthFactorBelow: { enabled: true, threshold: 1.01 }, positionAprBelow: { enabled: true, thresholdPercent: -5 } };
  expect(parsePositionAlertInput({ ...input, rules }).rules).toEqual(rules);
  for (const rules of [
    { ...input.rules, utilizationAbove: { enabled: true, thresholdPercent: null } },
    ...[-1, 101, Infinity, '90'].map(thresholdPercent => ({ ...input.rules, utilizationAbove: { enabled: true, thresholdPercent } })),
    { ...input.rules, healthFactorBelow: { enabled: true, threshold: 1.02 } },
    { ...input.rules, positionAprBelow: { enabled: true, thresholdPercent: NaN } },
    { ...input.rules, unexpected: true },
  ]) expect(() => parsePositionAlertInput({ ...input, rules })).toThrow();
  expect(() => parsePositionAlertInput({ ...input, network: 'moon' })).toThrow();
  expect(() => parsePositionAlertInput({ ...input, positionId: '' })).toThrow();
});
it('merges per-position alert timestamps independently of manual prices and latest wallet check, including disabling every rule', () => {
  const first = { version: 1 as const, wallets: [{ address, lastCheckedAt: later, manualLiquidationPrices: [], alerts: [{ ...input, rules: { ...input.rules, borrowAprAboveSupplyApr: true }, updatedAt: day }, { ...input, network: 'base' as const, updatedAt: day }] }] };
  const next = { version: 1 as const, wallets: [{ address, lastCheckedAt: day, manualLiquidationPrices: [{ network: 'ethereum' as const, protocol: 'aave-v3', positionId: 'prices', updatedAt: later, pricesUsd: { '0x1111111111111111111111111111111111111111': 12 } }], alerts: [{ ...input, positionId: 'aave-main', updatedAt: later }] }] };
  const merged = parseWalletHistory(mergeWalletHistory(first, next));
  expect(merged.wallets[0].lastCheckedAt).toBe(later);
  expect(merged.wallets[0].alerts).toHaveLength(2);
  expect(merged.wallets[0].alerts?.find(a => a.network === 'ethereum')?.rules.borrowAprAboveSupplyApr).toBe(false);
  expect(merged.wallets[0].manualLiquidationPrices).toHaveLength(1);
  expect(mergeWalletHistory(merged, first)).toEqual(merged);
  expect(() => parseWalletHistory({ version: 1, wallets: [{ ...next.wallets[0], alerts: [{ ...input, updatedAt: 'yesterday' }] }] })).toThrow();
});
it('lists only active overview lending/deposit positions, excluding bad debt, empty and unreadable markets and wallet tokens', () => {
  const p = structuredClone(example), template = p.protocols[0].positions[0];
  const supply = structuredClone(template); supply.id = 'deposit'; supply.debtUsd = 0; supply.assets = [{ ...supply.assets[0], supplied: 10, borrowed: 0, collateral: false }]; supply.depositOnly = true;
  const empty = { ...structuredClone(template), id: 'empty', suppliedUsd: 0, debtUsd: 0, assets: [] };
  const bad = { ...structuredClone(template), id: 'bad', suppliedUsd: 1, debtUsd: 100, collateralValueUsd: 1 };
  p.protocols = [{ ...p.protocols[0], positions: [template, supply, empty, bad, { ...empty, id: 'unreadable', suppliedUsd: null }] }];
  expect(alertPositions(p).map(x => x.position.id)).toEqual([template.id, 'deposit']);
  p.protocols[0].status = 'error'; expect(alertPositions(p)).toEqual([]);
});


it('defaults older saved rules to no new-liquidity alert and rejects non-boolean selections', () => {
  const { newLiquidityAdded, ...legacy } = defaultAlertRules();
  expect(parsePositionAlertInput({ ...input, rules: legacy }).rules.newLiquidityAdded).toBe(false);
  for (const value of [null, 'true', 1]) expect(() => parsePositionAlertInput({ ...input, rules: { ...legacy, newLiquidityAdded: value } })).toThrow();
  const saved = parseWalletHistory({ version: 1, wallets: [{ address, lastCheckedAt: day, manualLiquidationPrices: [], alerts: [{ ...input, rules: { ...legacy, newLiquidityAdded: true }, updatedAt: later }] }] });
  expect(saved.wallets[0].alerts?.[0].rules.newLiquidityAdded).toBe(true);
});

it('retains only enabled saved alerts for closed positions without changing overview or crossing chains', () => {
  const p = structuredClone(example), protocol = p.protocols[0];
  const saved = { network: 'ethereum' as const, protocol: protocol.id, positionId: 'closed', updatedAt: day, rules: { ...defaultAlertRules(), newLiquidityAdded: true } };
  protocol.positions = []; p.protocols = [protocol];
  expect(retainedAlertPositions(p, [saved, saved])).toMatchObject([{ closed: true, position: { id: 'closed', suppliedUsd: 0, debtUsd: 0 } }]);
  expect(alertPositions(p)).toEqual([]);
  expect(retainedAlertPositions(p, [{ ...saved, rules: defaultAlertRules() }])).toEqual([]);
  expect(retainedAlertPositions(p, [{ ...saved, network: 'base' }])[0].closed).toBe(false);
  for (const field of ['borrowAprAboveSupplyApr', 'newLiquidityAdded', 'utilizationAbove', 'healthFactorBelow', 'positionAprBelow'] as const) {
    const rules = defaultAlertRules();
    if (typeof rules[field] === 'boolean') Object.assign(rules, { [field]: true });
    else Object.assign(rules, { [field]: { ...rules[field] as object, enabled: true } });
    expect(retainedAlertPositions(p, [{ ...saved, rules }])).toHaveLength(1);
  }
});
it('does not manufacture zero balances after incomplete checks or for active risk-excluded positions', () => {
  const p = structuredClone(example), protocol = p.protocols[0], position = protocol.positions[0];
  const saved = { network: 'ethereum' as const, protocol: protocol.id, positionId: position.id, updatedAt: day, rules: { ...defaultAlertRules(), borrowAprAboveSupplyApr: true } };
  position.suppliedUsd = 1; position.debtUsd = 100; position.collateralValueUsd = 1;
  expect(retainedAlertPositions(p, [saved])).toEqual([]);
  protocol.positions = [];
  protocol.status = 'error'; expect(retainedAlertPositions(p, [saved])[0]).toMatchObject({ closed: false, position: { suppliedUsd: null, debtUsd: null } });
  protocol.status = 'partial'; expect(retainedAlertPositions(p, [saved])[0].closed).toBe(false);
  protocol.balanceDiscoveryComplete = true; expect(retainedAlertPositions(p, [saved])[0].closed).toBe(true);
  protocol.status = 'ok'; protocol.balanceDiscoveryComplete = false; expect(retainedAlertPositions(p, [saved])[0].closed).toBe(false);
  protocol.balanceDiscoveryComplete = true; p.networks = [{ chain: 'Ethereum', status: 'error', blockNumber: null, updatedAt: day }];
  expect(retainedAlertPositions(p, [saved])[0].closed).toBe(false);
});
