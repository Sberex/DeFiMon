import { getAddress, type Address } from 'viem';
import type { Portfolio, ProtocolResult } from '../src/types.js';
import { makeClient } from './rpc.js';
import { readAave } from './adapters/aave.js';
import { readAaveV4, AAVE_V4_COVERAGE } from './adapters/aave-v4.js';
import { readCompound } from './adapters/compound.js';
import { readFluid, FLUID_COVERAGE } from './adapters/fluid.js';
const planned = (id: string, name: string, coverage: string): ProtocolResult => ({ id, name, status: 'not-integrated', coverage, message: 'Not connected in this version. Positions and risk have not been checked.', positions: [] });
export const unconnected = () => [
  planned('morpho', 'Morpho', 'Market and vault discovery, balances, and liquidation calculations pending.'),
];
export async function isolateProtocol(id: string, name: string, coverage: string, run: () => Promise<ProtocolResult>): Promise<ProtocolResult> {
  try { return await run(); } catch {
    // Never send raw RPC errors: they can contain the server's provider URL / API key.
    return { id, name, coverage, status: 'error', message: 'Could not read this protocol. Its balances are unknown. Check Ethereum provider access and try again.', positions: [] };
  }
}
export async function getPortfolio(wallet: Address): Promise<Portfolio> {
  const address = getAddress(wallet);
  const client = makeClient();
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== 1) throw new Error('The configured provider is not Ethereum mainnet.');
  const [aave, aaveV4, fluid, compound] = await Promise.all([
    isolateProtocol('aave-v3', 'Aave v3', 'Ethereum main market', () => readAave(client, address, blockNumber)),
    isolateProtocol('aave-v4', 'Aave v4', AAVE_V4_COVERAGE, () => readAaveV4(client, address, blockNumber)),
    isolateProtocol('fluid', 'Fluid', FLUID_COVERAGE, () => readFluid(client, address, blockNumber)),
    isolateProtocol('compound', 'Compound', 'v3 USDC and WETH markets', () => readCompound(client, address, blockNumber)),
  ]);
  return { address, chain: 'Ethereum', blockNumber: String(blockNumber), updatedAt: new Date().toISOString(), protocols: [aave, aaveV4, unconnected()[0], compound, fluid] };
}
