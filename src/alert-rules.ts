import { isNetworkId, networkNames, portfolioNetwork } from './networks';
import { overviewProtocols } from './risk-assessment';
import type { Portfolio } from './types';
export interface PercentageAlert { enabled: boolean; thresholdPercent: number | null }
export interface AlertRules {
  borrowAprAboveSupplyApr: boolean;
  newLiquidityAdded: boolean;
  utilizationAbove: PercentageAlert;
  healthFactorBelow: { enabled: boolean; threshold: 1.01 };
  positionAprBelow: PercentageAlert;
}
export interface PositionAlertInput { network: keyof typeof networkNames; protocol: string; positionId: string; rules: AlertRules }
export interface PositionAlerts extends PositionAlertInput { updatedAt: string }
export const alertScopeKey = (v: Pick<PositionAlertInput, 'network' | 'protocol' | 'positionId'>) => JSON.stringify([v.network, v.protocol, v.positionId.toLowerCase()]);
export const defaultAlertRules = (): AlertRules => ({ borrowAprAboveSupplyApr: false, newLiquidityAdded: false, utilizationAbove: { enabled: false, thresholdPercent: null }, healthFactorBelow: { enabled: false, threshold: 1.01 }, positionAprBelow: { enabled: false, thresholdPercent: null } });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export function parsePositionAlertInput(value: unknown): PositionAlertInput {
  const fail = () => { throw new Error('Choose valid alert rules. Utilization must be 0–100%; enabled percentage rules need a finite threshold.'); };
  if (!object(value) || !keys(value, ['network', 'protocol', 'positionId', 'rules']) || !isNetworkId(value.network) || typeof value.protocol !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.protocol) || typeof value.positionId !== 'string' || !value.positionId.trim() || value.positionId.length > 512 || /[\x00-\x1f]/.test(value.positionId) || !object(value.rules)) return fail();
  const r = value.rules;
  if (!keys(r, ['borrowAprAboveSupplyApr', 'newLiquidityAdded', 'utilizationAbove', 'healthFactorBelow', 'positionAprBelow']) || typeof r.borrowAprAboveSupplyApr !== 'boolean' || r.newLiquidityAdded !== undefined && typeof r.newLiquidityAdded !== 'boolean' || !object(r.healthFactorBelow) || !keys(r.healthFactorBelow, ['enabled', 'threshold']) || typeof r.healthFactorBelow.enabled !== 'boolean' || r.healthFactorBelow.threshold !== 1.01) return fail();
  const percentage = (v: unknown, utilization: boolean): PercentageAlert => {
    if (!object(v) || !keys(v, ['enabled', 'thresholdPercent']) || typeof v.enabled !== 'boolean' || !(v.thresholdPercent === null || typeof v.thresholdPercent === 'number' && Number.isFinite(v.thresholdPercent)) || v.enabled && v.thresholdPercent === null || utilization && typeof v.thresholdPercent === 'number' && (v.thresholdPercent < 0 || v.thresholdPercent > 100)) return fail();
    return { enabled: v.enabled, thresholdPercent: v.thresholdPercent };
  };
  return { network: value.network, protocol: value.protocol, positionId: value.positionId, rules: { borrowAprAboveSupplyApr: r.borrowAprAboveSupplyApr, newLiquidityAdded: r.newLiquidityAdded === true, utilizationAbove: percentage(r.utilizationAbove, true), healthFactorBelow: { enabled: r.healthFactorBelow.enabled, threshold: 1.01 }, positionAprBelow: percentage(r.positionAprBelow, false) } };
}
export function alertPositions(portfolio: Portfolio) {
  return overviewProtocols(portfolio.protocols).filter(p => ['ok', 'partial'].includes(p.status)).flatMap(protocol => protocol.positions.filter(p => p.assets.some(a => Number.isFinite(a.supplied) && a.supplied > 0 || Number.isFinite(a.borrowed) && a.borrowed > 0)).map(position => ({ protocol, position, network: portfolioNetwork(protocol.chain ?? portfolio.chain), chain: protocol.chain ?? networkNames[portfolioNetwork(portfolio.chain)] })));
}
