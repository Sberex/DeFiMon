import { afterEach, expect, it, vi } from 'vitest';
import { snapshot } from './fixtures/cookbook';

async function withThreshold(percent: number) {
  vi.resetModules();
  vi.doMock('../config/config.json', () => ({ default: { cookbook: { minimumAprPercent: percent } } }));
  return import('../src/cookbook');
}
afterEach(() => { vi.doUnmock('../config/config.json'); vi.resetModules(); });

it('applies a changed config threshold to capture, legacy snapshots, summaries and merging', async () => {
  const old = await withThreshold(14);
  const saved = old.updateCookbook(old.emptyCookbook(), snapshot(.2));
  const higher = await withThreshold(25);
  // The old file remains readable even though its threshold metadata differs.
  const loaded = higher.parseCookbook(saved);
  expect(higher.cookbookPositions(loaded)).toEqual([]);
  expect(higher.cookbookSuppliedAssets(higher.cookbookPositions(loaded))).toEqual([]);
  expect(higher.cookbookPositions(higher.updateCookbook(higher.emptyCookbook(), snapshot(.25)))).toEqual([]);
  expect(higher.cookbookPositions(higher.updateCookbook(higher.emptyCookbook(), snapshot(.26)))).toHaveLength(1);
  expect(higher.mergeCookbooks(loaded, higher.emptyCookbook()).minimumApr).toBe(.25);
  expect(higher.updateCookbook(loaded, snapshot(.3)).minimumApr).toBe(.25);
  const lower = await withThreshold(12.5);
  expect(lower.cookbookPositions(lower.parseCookbook(saved))).toHaveLength(1);
  expect(lower.cookbookPositions(lower.updateCookbook(lower.emptyCookbook(), snapshot(.125)))).toEqual([]);
  expect(lower.cookbookPositions(lower.updateCookbook(lower.emptyCookbook(), snapshot(.13)))).toHaveLength(1);
});

it('validates the setting and supports zero without a hidden 14% fallback', async () => {
  const { parseAppConfig } = await import('../src/app-config');
  for (const value of [null, {}, { cookbook: {} }, ...[-1, Infinity, NaN, '14', null].map(minimumAprPercent => ({ cookbook: { minimumAprPercent } }))]) {
    expect(() => parseAppConfig(value)).toThrow('cookbook.minimumAprPercent');
  }
  const zero = await withThreshold(0);
  expect(zero.COOKBOOK_MIN_APR).toBe(0);
  expect(zero.cookbookPositions(zero.updateCookbook(zero.emptyCookbook(), snapshot(.01)))).toHaveLength(1);
  expect(() => zero.parseCookbook({ ...zero.emptyCookbook(), minimumApr: '14' })).toThrow();
});
