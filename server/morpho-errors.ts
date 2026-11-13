export type MorphoFailureCode = 'network' | 'timeout' | 'http' | 'schema' | 'response';
export interface MorphoFailure {
  family: string; code: MorphoFailureCode; httpStatus?: number; schemaDetail?: string; networkCode?: string;
}
export class MorphoLookupError extends Error {
  constructor(public readonly code: MorphoFailureCode, public readonly info: Omit<MorphoFailure, 'family' | 'code'> = {}) {
    super(`Morpho lookup failed: ${code}`);
  }
}
const networkCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
export function morphoNetworkError(error: unknown): MorphoLookupError {
  const e = error as { name?: string; cause?: { code?: string }; code?: string } | null;
  const candidate = e?.cause?.code ?? e?.code;
  const networkCode = candidate && networkCodes.has(candidate) ? candidate : undefined;
  return new MorphoLookupError(e?.name === 'TimeoutError' || e?.name === 'AbortError' || networkCode === 'ETIMEDOUT' || networkCode === 'UND_ERR_CONNECT_TIMEOUT' ? 'timeout' : 'network', { networkCode });
}
/** Only extract known schema-validation names. Never forward arbitrary upstream text or credentials. */
export function safeSchemaDetail(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) return undefined;
  for (const error of errors) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const field = message.match(/Cannot query field ["']([A-Za-z_][A-Za-z_0-9]{0,63})["'] on type ["']([A-Za-z_][A-Za-z_0-9]{0,63})["']/);
    if (field) return `Unsupported field ${field[2]}.${field[1]}`;
    const argument = message.match(/Unknown argument ["']([A-Za-z_][A-Za-z_0-9]{0,63})["'] on field ["']([A-Za-z_][A-Za-z_0-9.]{0,127})["']/);
    if (argument) return `Unsupported argument ${argument[2]}(${argument[1]})`;
  }
  return undefined;
}
export function toMorphoFailure(family: string, error: unknown): MorphoFailure {
  return error instanceof MorphoLookupError ? { family, code: error.code, ...error.info } : { family, code: 'response' };
}
export class MorphoDiscoveryUnavailable extends Error {
  constructor(public readonly failures: MorphoFailure[]) { super('Morpho discovery unavailable'); }
  get publicMessage(): string {
    if (this.failures.some(f => f.code === 'schema')) return 'Morpho rejected the website’s lookup query. The integration needs a compatibility update. Its balances are unknown.';
    if (this.failures.some(f => f.httpStatus === 429)) return 'Morpho is limiting lookup requests. Wait a little and refresh. Its balances are unknown.';
    const http = this.failures.find(f => f.code === 'http');
    if (http) return `The Morpho lookup request was refused or failed (HTTP ${http.httpStatus}). Its balances are unknown.`;
    if (this.failures.some(f => f.code === 'timeout')) return 'The Morpho lookup timed out. Try again shortly. Its balances are unknown.';
    if (this.failures.some(f => f.code === 'network')) return 'The website server could not reach api.morpho.org. Check that computer’s connection, proxy, and certificate settings. Morpho balances are unknown.';
    return 'Morpho returned an unexpected lookup response. Its positions and balances could not be verified.';
  }
}
