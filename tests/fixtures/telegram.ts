import type { LiquidityNotification } from '../../server/liquidity-alert-tracker';
import type { UtilizationNotification } from '../../server/utilization-alert-tracker';
import type { TelegramSnapshot } from '../../server/telegram-alerts';
import { defaultAlertRules } from '../../src/alert-rules';
export const at = (minutes: number) => new Date(Date.parse('2026-11-23T15:00:00.000Z') + minutes * 60000).toISOString();
const wallet = '0x1111111111111111111111111111111111111111', market = '0x2222222222222222222222222222222222222222', token = '0x3333333333333333333333333333333333333333';
const common = { address: wallet, network: 'ethereum' as const, protocol: 'morpho', positionId: 'market-one', market: '0x'+'4'.repeat(64), marketAddress: market, marketLabel: 'USDC market', token, symbol: 'USDC', timestamp: at(1), blockNumber: '100', note: 'Verified state.' };
export const liquidity: LiquidityNotification = { ...common, id: 'a'.repeat(64), type: 'available-liquidity-increased', decimals: 6, previousLiquidity: '1', availableLiquidity: '2', liquidityChange: '1', previousRaw: '1000000', availableRaw: '2000000', changeRaw: '1000000', previousCheckedAt: at(0) };
export const utilization: UtilizationNotification = { ...common, id: 'b'.repeat(64), type: 'utilization-above-threshold', thresholdPercent: 90, previousUtilizationPercent: 89, utilizationPercent: 91, utilizationChangePercentagePoints: 2, previousCheckedAt: at(0) };
export function snapshot(): TelegramSnapshot { return { state: { version: 1, enabledAt: at(0), deliveries: [] }, history: { version: 1, wallets: [{ address: wallet, lastCheckedAt: at(0), manualLiquidationPrices: [], alerts: [{ network: 'ethereum', protocol: 'morpho', positionId: 'market-one', updatedAt: at(0), rules: { ...defaultAlertRules(), newLiquidityAdded: true, utilizationAbove: { enabled: true, thresholdPercent: 90 } } }] }] }, notifications: [structuredClone(liquidity), structuredClone(utilization)] }; }
