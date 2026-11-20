import { isAddress, type Address } from 'viem';
import type { NetworkId } from '../src/types.js';
import { networkOrder } from '../src/networks.js';
export interface IntrinsicOracle {
  network: NetworkId; kind: 'chainlink' | 'erc4626'; address: Address; token: Address;
  description?: string; decimals?: number; underlying?: Address; computed?: boolean;
  tokenGetter?: 'receiptToken'; history?: 'rounds'; label: string; note?: string; evidence?: string;
}
const address = (v: unknown): v is Address => typeof v === 'string' && isAddress(v, { strict: false }) && !/^0x(?:0{40}|e{40})$/i.test(v);
export function parseIntrinsicOracles(value: unknown, addresses: Record<string, string | undefined>, name: string): IntrinsicOracle[] {
  const fail = () => { throw new Error(`Invalid _intrinsicOracles for ${name}. Each source needs a supported network, oracle address, matching token contract, reader kind and label.`); };
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return fail();
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
    const s = item as IntrinsicOracle;
    const keys = new Set(['network', 'kind', 'address', 'token', 'description', 'decimals', 'underlying', 'computed', 'tokenGetter', 'history', 'label', 'note', 'evidence']);
    if (Object.keys(item).some(k => !keys.has(k)) || !networkOrder.includes(s.network) || !address(s.address) || !address(s.token) || addresses[s.network]?.toLowerCase() !== s.token.toLowerCase() || !['chainlink', 'erc4626'].includes(s.kind) || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 300) return fail();
    if (s.decimals !== undefined && (!Number.isInteger(s.decimals) || s.decimals < 0 || s.decimals > 36)) return fail();
    if (s.description !== undefined && (typeof s.description !== 'string' || !s.description.trim() || s.description.length > 300)) return fail();
    if (s.history !== undefined && (s.history !== 'rounds' || s.kind !== 'chainlink' || s.computed || s.decimals === undefined || !s.description)) return fail();
    if (s.computed !== undefined && typeof s.computed !== 'boolean') return fail();
    if (s.tokenGetter !== undefined && s.tokenGetter !== 'receiptToken') return fail();
    if (s.computed && (s.kind !== 'chainlink' || s.tokenGetter !== 'receiptToken' || !s.description || s.decimals === undefined)) return fail();
    if (s.underlying !== undefined && !address(s.underlying)) return fail();
    if (s.kind === 'erc4626' && (s.address.toLowerCase() !== s.token.toLowerCase() || !s.underlying || s.computed || s.tokenGetter || s.history)) return fail();
    if ([s.note, s.evidence].some(v => v !== undefined && (typeof v !== 'string' || v.length > 4000))) return fail();
    const key = `${s.network}:${s.address.toLowerCase()}:${s.kind}`;
    if (seen.has(key)) return fail(); seen.add(key);
    return { ...s };
  });
}
