import config from '../config/config.json' with { type: 'json' };

export function parseAppConfig(value: unknown): { cookbook: { minimumAprPercent: number } } {
  const percent = (value as { cookbook?: { minimumAprPercent?: unknown } } | null)?.cookbook?.minimumAprPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) {
    throw new Error('config/config.json: cookbook.minimumAprPercent must be a finite, non-negative percentage.');
  }
  return { cookbook: { minimumAprPercent: percent } };
}

export const appConfig = parseAppConfig(config);
export const cookbookMinimumAprPercent = appConfig.cookbook.minimumAprPercent;
