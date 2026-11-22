import { isNetworkId } from './networks';
import type { NetworkId, Position } from './types';
import { liquidationScenario } from './liquidation';
import { alertScopeKey, parsePositionAlertInput, type PositionAlerts } from './alert-rules';
export interface ManualLiquidationPrices {
  network: NetworkId; protocol: string; positionId: string; updatedAt: string;
  pricesUsd: Record<string, number>;
}
export type ManualPriceInput = Omit<ManualLiquidationPrices, 'updatedAt'>;
export interface SavedWallet { address: string; lastCheckedAt: string; manualLiquidationPrices: ManualLiquidationPrices[]; alerts?: PositionAlerts[] }
export interface WalletHistoryFile { version: 1; wallets: SavedWallet[] }
export interface WalletHistoryResponse {
  wallet: SavedWallet | null;
  persistence: { mode: 'github' | 'local'; synced: boolean; message?: string };
}
const validAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export function walletKey(value: unknown): string {
  if (!validAddress(value)) throw new Error('Invalid wallet address.');
  return value.toLowerCase();
}
export const manualPriceKey = (v: Pick<ManualLiquidationPrices, 'network' | 'protocol' | 'positionId'>) => JSON.stringify([v.network, v.protocol, v.positionId.toLowerCase()]);
export function parseManualPriceInput(value: unknown): ManualPriceInput {
  const fail = () => { throw new Error('Provide a valid network, protocol, position ID and collateral contract prices in USD (zero or greater).'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (!only(v, ['network', 'protocol', 'positionId', 'pricesUsd']) || !isNetworkId(v.network) || typeof v.protocol !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(v.protocol) || typeof v.positionId !== 'string' || !v.positionId.trim() || v.positionId.length > 512 || /[\x00-\x1f]/.test(v.positionId) || !v.pricesUsd || typeof v.pricesUsd !== 'object' || Array.isArray(v.pricesUsd)) return fail();
  const entries = Object.entries(v.pricesUsd);
  if (!entries.length || entries.length > 64) return fail();
  const pricesUsd: Record<string, number> = {};
  for (const [address, price] of entries) {
    if (!validAddress(address) || typeof price !== 'number' || !Number.isFinite(price) || price < 0 || Object.hasOwn(pricesUsd, address.toLowerCase())) return fail();
    pricesUsd[address.toLowerCase()] = price;
  }
  return { network: v.network, protocol: v.protocol, positionId: v.positionId, pricesUsd };
}
function mergeWallet(a: SavedWallet, b: SavedWallet): SavedWallet {
  const rows = new Map(a.manualLiquidationPrices.map(p => [manualPriceKey(p), p]));
  for (const p of b.manualLiquidationPrices) {
    const old = rows.get(manualPriceKey(p));
    if (!old || p.updatedAt >= old.updatedAt) rows.set(manualPriceKey(p), p);
  }
  const alerts = new Map((a.alerts ?? []).map(p => [alertScopeKey(p), p]));
  for (const p of b.alerts ?? []) {
    const old = alerts.get(alertScopeKey(p));
    if (!old || p.updatedAt >= old.updatedAt) alerts.set(alertScopeKey(p), p);
  }
  return { address: walletKey(a.address), lastCheckedAt: a.lastCheckedAt > b.lastCheckedAt ? a.lastCheckedAt : b.lastCheckedAt, manualLiquidationPrices: [...rows.values()].sort((a, b) => manualPriceKey(a).localeCompare(manualPriceKey(b))), ...(a.alerts || b.alerts ? { alerts: [...alerts.values()].sort((a, b) => alertScopeKey(a).localeCompare(alertScopeKey(b))) } : {}) };
}
export function mergeWalletHistory(a: WalletHistoryFile, b: WalletHistoryFile): WalletHistoryFile {
  const wallets = new Map<string, SavedWallet>();
  for (const w of [...a.wallets, ...b.wallets]) {
    const key = walletKey(w.address), old = wallets.get(key);
    wallets.set(key, mergeWallet(old ?? { address: key, lastCheckedAt: w.lastCheckedAt, manualLiquidationPrices: [] }, w));
  }
  return { version: 1, wallets: [...wallets.values()].sort((a, b) => a.address.localeCompare(b.address)) };
}
export function parseWalletHistory(value: unknown): WalletHistoryFile {
  const fail = () => { throw new Error('Wallet history JSON is invalid. Existing records were not replaced.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (!only(v, ['version', 'wallets']) || v.version !== 1 || !Array.isArray(v.wallets)) return fail();
  const wallets = v.wallets.map(w => {
    if (!w || typeof w !== 'object' || Array.isArray(w) || !only(w, ['address', 'lastCheckedAt', 'manualLiquidationPrices', 'alerts']) || !validAddress(w.address) || !iso(w.lastCheckedAt) || !Array.isArray(w.manualLiquidationPrices) || w.alerts !== undefined && !Array.isArray(w.alerts)) return fail();
    const manualLiquidationPrices = w.manualLiquidationPrices.map((p: any) => {
      if (!p || typeof p !== 'object' || !iso(p.updatedAt)) return fail();
      const { updatedAt, ...input } = p;
      return { ...parseManualPriceInput(input), updatedAt };
    });
    const alerts = w.alerts?.map((p: any) => {
      if (!p || typeof p !== 'object' || !iso(p.updatedAt)) return fail();
      const { updatedAt, ...input } = p;
      return { ...parsePositionAlertInput(input), updatedAt };
    });
    return { address: walletKey(w.address), lastCheckedAt: w.lastCheckedAt, manualLiquidationPrices, ...(alerts ? { alerts } : {}) };
  });
  return mergeWalletHistory({ version: 1, wallets: [] }, { version: 1, wallets });
}
function decimalInput(value: number): string {
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa, exponent] = text.toLowerCase().split('e');
  const digits = mantissa.replace('.', ''), point = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
export function savedManualPrices(wallet: SavedWallet | null | undefined, network: NetworkId, protocol: string, position: Position) {
  const saved = wallet?.manualLiquidationPrices.find(p => manualPriceKey(p) === manualPriceKey({ network, protocol, positionId: position.id }));
  const prices: Record<string, string> = {};
  for (const asset of liquidationScenario(position).others) {
    const value = saved?.pricesUsd[asset.address.toLowerCase()];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) prices[asset.address] = decimalInput(value);
  }
  return { prices, updatedAt: Object.keys(prices).length ? saved?.updatedAt : undefined };
}
