import { configuredTokenRegistry, type TokenRegistry } from './token-registry.js';
import { savingsRateService } from './savings-rates.js';
import type { IntrinsicRate, NetworkId } from '../src/types.js';
import type { SavingsCatalogRate } from '../src/savings-catalog.js';
export function createSavingsCatalogReader(load: (group: string, context: { network: NetworkId }) => Promise<IntrinsicRate> = savingsRateService.quote, registry: TokenRegistry = configuredTokenRegistry, now = Date.now) {
  return async (group: string): Promise<SavingsCatalogRate> => {
    const token = Object.hasOwn(registry, group) ? registry[group] : undefined;
    if (!token || token.category !== 'Savings stablecoin') throw Error('Not a configured Savings stablecoin');
    const source = token.intrinsicOracles?.[0];
    if (!source) return { group, checkedAt: new Date(now()).toISOString(), quote: null, reason: 'No verified intrinsic-rate source is configured for this asset.' };
    const quote = await load(group, { network: source.network });
    return { group, checkedAt: new Date(now()).toISOString(), quote };
  };
}
export const readSavingsCatalogRate = createSavingsCatalogReader();
