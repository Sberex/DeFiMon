import { isNetworkId, networkNames, portfolioNetwork } from './networks';
import { overviewProtocols } from './risk-assessment';
import type { Portfolio, Position, ProtocolResult } from './types';
export interface PercentageAlert { enabled: boolean; thresholdPercent: number | null }
export interface AlertRules {
  borrowAprAboveSupplyApr: boolean;
  newLiquidityAdded: boolean;
  liquidityWithdrawn: boolean;
  utilizationAbove: PercentageAlert;
  healthFactorBelow: { enabled: boolean; threshold: 1.01 };
  positionAprBelow: PercentageAlert;
}
export interface PositionAlertInput { network: keyof typeof networkNames; protocol: string; positionId: string; rules: AlertRules }
export interface PositionAlerts extends PositionAlertInput { updatedAt: string }
export const alertScopeKey = (v: Pick<PositionAlertInput, 'network' | 'protocol' | 'positionId'>) => JSON.stringify([v.network, v.protocol, v.positionId.toLowerCase()]);
export const defaultAlertRules = (): AlertRules => ({ borrowAprAboveSupplyApr: false, newLiquidityAdded: false, liquidityWithdrawn: false, utilizationAbove: { enabled: false, thresholdPercent: null }, healthFactorBelow: { enabled: false, threshold: 1.01 }, positionAprBelow: { enabled: false, thresholdPercent: null } });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export function parsePositionAlertInput(value: unknown): PositionAlertInput {
  const fail = () => { throw new Error('Choose valid alert rules. Utilization must be 0–100%; enabled percentage rules need a finite threshold.'); };
  if (!object(value) || !keys(value, ['network', 'protocol', 'positionId', 'rules']) || !isNetworkId(value.network) || typeof value.protocol !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(value.protocol) || typeof value.positionId !== 'string' || !value.positionId.trim() || value.positionId.length > 512 || /[\x00-\x1f]/.test(value.positionId) || !object(value.rules)) return fail();
  const r = value.rules;
  if (!keys(r, ['borrowAprAboveSupplyApr', 'newLiquidityAdded', 'liquidityWithdrawn', 'utilizationAbove', 'healthFactorBelow', 'positionAprBelow']) || typeof r.borrowAprAboveSupplyApr !== 'boolean' || r.newLiquidityAdded !== undefined && typeof r.newLiquidityAdded !== 'boolean' || r.liquidityWithdrawn !== undefined && typeof r.liquidityWithdrawn !== 'boolean' || !object(r.healthFactorBelow) || !keys(r.healthFactorBelow, ['enabled', 'threshold']) || typeof r.healthFactorBelow.enabled !== 'boolean' || r.healthFactorBelow.threshold !== 1.01) return fail();
  const percentage = (v: unknown, utilization: boolean): PercentageAlert => {
    if (!object(v) || !keys(v, ['enabled', 'thresholdPercent']) || typeof v.enabled !== 'boolean' || !(v.thresholdPercent === null || typeof v.thresholdPercent === 'number' && Number.isFinite(v.thresholdPercent)) || v.enabled && v.thresholdPercent === null || utilization && typeof v.thresholdPercent === 'number' && (v.thresholdPercent < 0 || v.thresholdPercent > 100)) return fail();
    return { enabled: v.enabled, thresholdPercent: v.thresholdPercent };
  };
  return { network: value.network, protocol: value.protocol, positionId: value.positionId, rules: { borrowAprAboveSupplyApr: r.borrowAprAboveSupplyApr, newLiquidityAdded: r.newLiquidityAdded === true, liquidityWithdrawn: r.liquidityWithdrawn === true, utilizationAbove: percentage(r.utilizationAbove, true), healthFactorBelow: { enabled: r.healthFactorBelow.enabled, threshold: 1.01 }, positionAprBelow: percentage(r.positionAprBelow, false) } };
}
export function alertPositions(portfolio: Portfolio) {
  return overviewProtocols(portfolio.protocols).filter(p => ['ok', 'partial'].includes(p.status)).flatMap(protocol => protocol.positions.filter(p => p.assets.some(a => Number.isFinite(a.supplied) && a.supplied > 0 || Number.isFinite(a.borrowed) && a.borrowed > 0)).map(position => ({ protocol, position, network: portfolioNetwork(protocol.chain ?? portfolio.chain), chain: protocol.chain ?? networkNames[portfolioNetwork(portfolio.chain)] })));
}

/** Saved alerts remain editable after balances disappear. Never infer closure from a failed check. */
export function retainedAlertPositions(portfolio: Portfolio, alerts: PositionAlerts[] = []) {
  const active = new Set(alertPositions(portfolio).map(entry => alertScopeKey({ network: entry.network, protocol: entry.protocol.id, positionId: entry.position.id })));
  const seen = new Set<string>();
  return alerts.flatMap(saved => {
    const rules = saved.rules, key = alertScopeKey(saved);
    if (active.has(key) || seen.has(key) || !(rules.borrowAprAboveSupplyApr || rules.newLiquidityAdded || rules.liquidityWithdrawn || rules.utilizationAbove.enabled || rules.healthFactorBelow.enabled || rules.positionAprBelow.enabled)) return [];
    seen.add(key);
    const chain = networkNames[saved.network];
    const protocol = portfolio.protocols.find(p => p.id === saved.protocol && portfolioNetwork(p.chain ?? portfolio.chain) === saved.network);
    const existing = protocol?.positions.find(p => p.id.toLowerCase() === saved.positionId.toLowerCase());
    // An active risk-excluded position belongs in Risk Assessment, not a zero-balance card.
    if (existing?.assets.some(a => a.supplied > 0 || a.borrowed > 0) || existing?.suppliedUsd && existing.suppliedUsd > 0 || existing?.debtUsd && existing.debtUsd > 0) return [];
    const checked = !!protocol && (protocol.status === 'ok' && protocol.balanceDiscoveryComplete !== false || protocol.status === 'partial' && protocol.balanceDiscoveryComplete === true) && !portfolio.networks?.some(n => n.chain === chain && n.status === 'error');
    const closed = checked && (!existing || existing.suppliedUsd === 0 && existing.debtUsd === 0 && existing.assets.every(a => a.supplied === 0 && a.borrowed === 0));
    const position: Position = { id: saved.positionId, label: existing?.label ?? saved.positionId, marketAddress: existing?.marketAddress, suppliedUsd: closed ? 0 : null, debtUsd: closed ? 0 : null, healthFactor: null, risk: 'no-debt', assets: [], notes: [] };
    const fallback: ProtocolResult = { id: saved.protocol, name: saved.protocol, status: 'error', coverage: '', positions: [] };
    return [{ protocol: protocol ?? fallback, position, network: saved.network, chain, closed }];
  });
}
