import { MorphoDiscoveryUnavailable } from './morpho-errors.js';
import { getAddress, type Address } from 'viem';
import type { ExtraTokens, NetworkId, Portfolio, ProtocolResult, WalletBalances } from '../src/types.js';
import { readWallet, unavailableWallet } from './wallet.js';
import { networks } from './networks.js';
import { makeClient } from './rpc.js';
import { readAave } from './adapters/aave.js';
import { readAaveV4, AAVE_V4_COVERAGE } from './adapters/aave-v4.js';
import { readCompound } from './adapters/compound.js';
import { readFluid, FLUID_COVERAGE } from './adapters/fluid.js';
import { readMorpho, MORPHO_COVERAGE } from './adapters/morpho.js';
export async function isolateProtocol(id: string, name: string, coverage: string, run: () => Promise<ProtocolResult>, failureMessage = 'Could not read this protocol. Its balances are unknown. Check Ethereum provider access and try again.'): Promise<ProtocolResult> {
  try { return await run(); } catch (error) {
    // Never send raw RPC errors: they can contain the server's provider URL / API key.
    return { id, name, coverage, status: 'error', message: id === 'morpho' && error instanceof MorphoDiscoveryUnavailable ? error.publicMessage : failureMessage, positions: [] };
  }
}
export async function getPortfolio(wallet: Address, network: NetworkId = 'ethereum', extraTokens: ExtraTokens = {}): Promise<Portfolio> {
  const address = getAddress(wallet);
  const deployment = networks[network];
  const client = makeClient(network);
  const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  if (chainId !== deployment.id) throw new Error(`The configured provider is not ${deployment.name} mainnet.`);
  if (network === 'plasma') {
    const failure = 'Could not read this protocol on Plasma. Its balances are unknown. Check the Plasma provider connection and try again.';
    const protocols = await Promise.all([
      isolateProtocol('aave-v3', 'Aave v3', 'Plasma main market', () => readAave(client, address, blockNumber, network), failure),
      isolateProtocol('fluid', 'Fluid', FLUID_COVERAGE.replace('Ethereum', 'Plasma'), () => readFluid(client, address, blockNumber, network), failure),
    ]);
    const walletBalances = await readWallet(client, address, blockNumber, network, protocols, extraTokens[network]).catch(() => unavailableWallet(network));
    return { wallets: [walletBalances], address, chain: 'Plasma', blockNumber: String(blockNumber), updatedAt: new Date().toISOString(), protocols };
  }
  const [aave, aaveV4, morpho, fluid, compound] = await Promise.all([
    isolateProtocol('aave-v3', 'Aave v3', 'Ethereum main market', () => readAave(client, address, blockNumber)),
    isolateProtocol('aave-v4', 'Aave v4', AAVE_V4_COVERAGE, () => readAaveV4(client, address, blockNumber)),
    isolateProtocol('morpho', 'Morpho', MORPHO_COVERAGE, () => readMorpho(client, address, blockNumber), 'Morpho lookup is unavailable. Check access to api.morpho.org and your Ethereum provider. Its balances are unknown.'),
    isolateProtocol('fluid', 'Fluid', FLUID_COVERAGE, () => readFluid(client, address, blockNumber)),
    isolateProtocol('compound', 'Compound', 'v3 USDC and WETH markets', () => readCompound(client, address, blockNumber)),
  ]);
  const walletBalances = await readWallet(client, address, blockNumber, network, [aave, aaveV4, morpho, compound, fluid], extraTokens[network]).catch(() => unavailableWallet(network));
  return { wallets: [walletBalances], address, chain: 'Ethereum', blockNumber: String(blockNumber), updatedAt: new Date().toISOString(), protocols: [aave, aaveV4, morpho, compound, fluid] };
}

export async function getCombinedPortfolio(wallet: Address, load: (wallet: Address, network: NetworkId, extraTokens?: ExtraTokens) => Promise<Portfolio> = getPortfolio, extraTokens: ExtraTokens = {}): Promise<Portfolio> {
  const address = getAddress(wallet);
  const networkIds: NetworkId[] = ['ethereum', 'plasma'];
  // Each network pins its own block. One failed provider must not discard the
  // other network or turn unchecked positions into a verified empty balance.
  const results = await Promise.allSettled(networkIds.map(network => load(address, network, extraTokens)));
  const snapshots: NonNullable<Portfolio['networks']> = [];
  const protocols: ProtocolResult[] = [];
  const wallets: WalletBalances[] = [];
  const readers = [['aave-v3', 'Aave v3'], ['aave-v4', 'Aave v4'], ['morpho', 'Morpho'], ['compound', 'Compound'], ['fluid', 'Fluid']];
  results.forEach((result, i) => {
    const network = networkIds[i];
    const chain = networks[network].name;
    if (result.status === 'fulfilled') {
      wallets.push(...(result.value.wallets ?? []));
      snapshots.push({ chain, blockNumber: result.value.blockNumber, updatedAt: result.value.updatedAt, status: 'ok' });
      protocols.push(...result.value.protocols.map(protocol => ({ ...protocol, chain })));
    } else {
      wallets.push(unavailableWallet(network));
      const message = `${chain} connection unavailable. Its balances and risk are unknown. Check the ${chain} provider connection and refresh.`;
      snapshots.push({ chain, blockNumber: null, updatedAt: new Date().toISOString(), status: 'error', message });
      for (const [id, name] of readers) {
        if (network === 'plasma' && id !== 'aave-v3' && id !== 'fluid') continue;
        protocols.push({ id, name, chain, coverage: `${chain} · supported markets could not be checked`, status: 'error', message, positions: [] });
      }
    }
  });
  const order = readers.map(([id]) => id);
  protocols.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || (a.chain === 'Ethereum' ? 0 : 1) - (b.chain === 'Ethereum' ? 0 : 1));
  return { address, chain: 'Ethereum + Plasma', blockNumber: null, updatedAt: new Date().toISOString(), networks: snapshots, protocols, wallets };
}
