import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { configuredTokenRegistry } from '../server/token-registry';
import { correspondingTokens } from '../server/market-tokens';
const config = JSON.parse(readFileSync(new URL('../config/token-matches.json', import.meta.url), 'utf8'));
const audit = JSON.parse(readFileSync(new URL('../config/token-matches.pharos.json', import.meta.url), 'utf8'));
it('keeps every audited existing category and conflicting contract while attaching Pharos page metadata', () => {
  for (const match of audit.matches) {
    expect(config[match.group]._category).toBe(match.categoryPreserved);
    expect(configuredTokenRegistry[match.group].safetyScore).toBe(match.url);
  }
  for (const conflict of audit.conflicts) {
    if (conflict.existing && conflict.network) expect(config[conflict.group][conflict.network]).toBe(conflict.existing);
  }
  for (const addition of audit.newContracts) expect(config[addition.group][addition.network]).toBe(addition.address);
  expect(config.sUSDai['Safety Score']).toBe('https://pharos.watch/stablecoin/susdai-usd-ai/');
});
it('keeps same-ticker M0 separate and never matches independent Gauntlet vaults across networks', () => {
  expect(config['M#pharos-m-m0']._category).toBe('Stablecoin');
  expect(config.M.ethereum).not.toBe(config['M#pharos-m-m0'].ethereum);
  expect(correspondingTokens(config.gtUSDCp.ethereum, 'ethereum', 'base')).toEqual([]);
  const primes = Object.entries(configuredTokenRegistry).filter(([group]) => group === 'gtUSDCp' || group.startsWith('gtUSDCp#pharos-gauntlet-'));
  expect(primes).toHaveLength(4);
  for (const [, token] of primes) expect(Object.keys(token.addresses)).toHaveLength(1);
});
it('wires verified 30-day canonical exchange-rate observations to the exact token contracts and preserves negative returns', () => {
  for (const update of audit.oracleUpdates) {
    const token = configuredTokenRegistry[update.group];
    const source = token.intrinsicOracles?.find(s => s.network === update.network && s.address === update.address);
    expect(source).toMatchObject({ kind: 'erc4626', token: token.addresses[update.network], underlying: update.underlying });
    const expected = Number(BigInt(update.endRate) - BigInt(update.startRate)) / Number(BigInt(update.startRate)) * 365 / 30;
    expect(update.apr).toBeCloseTo(expected, 12);
    expect(update.endTimestamp - update.startTimestamp).toBeGreaterThanOrEqual(30 * 86400);
    expect(update.endTimestamp - update.startTimestamp).toBeLessThan(30 * 86400 + 3600);
  }
  expect(audit.oracleUpdates.find((u: { group: string }) => u.group === 'sUSDat').apr).toBeLessThan(0);
  for (const group of ['yBOLD', 'USDN', 'stkGHO.v1']) expect(configuredTokenRegistry[group].category).toBe('Savings stablecoin');
  expect(configuredTokenRegistry.WEUSD.category).toBe('Other');
});
