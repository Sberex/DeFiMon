import { parseAbi } from 'viem';
import { listaCatalog, listaNote } from './lista.js';
import { listaDeployments, listaUrl, isLegacyListaVault } from './deployments/lista.js';
import { createMorphoRates } from './morpho-rates.js';
import { morphoCoreAbi, morphoFactoryAbi, morphoVaultAbi } from './abis/morpho.js';
import { limited, option, type Reader } from './market-readers.js';
import { liquidityQuote, tokenMetadata } from './market-liquidity.js';
export const listaAccessAbi = parseAbi(['function paused() view returns(bool)', 'function brokers(bytes32) view returns(address)', 'function getWhiteList(bytes32) view returns(address[])', 'function getWhiteList() view returns(address[])', 'function maxDeposit(address) view returns(uint256)']);
const zero = '0x0000000000000000000000000000000000000000';
export const readListaMarkets: Reader = async (client, network, block, targets, warn) => {
  const deployment = listaDeployments[network]; if (!deployment) throw new Error('Unsupported Lista network');
  const catalog = await listaCatalog(network);
  if (await client.readContract({ address: deployment.core, abi: listaAccessAbi, functionName: 'paused', blockNumber: block })) return [];
  const rates = createMorphoRates(client, block, deployment.core, 'MOOLAH');
  const params = catalog.markets.length ? await client.multicall({ contracts: catalog.markets.map(id => ({ address: deployment.core, abi: morphoCoreAbi, functionName: 'idToMarketParams' as const, args: [id] as const })), blockNumber: block, allowFailure: true, batchSize: 8192 }) : [];
  if (params.length !== catalog.markets.length) throw new Error('Incomplete Lista markets');
  const markets = await limited(catalog.markets.map((id, i) => ({ id, params: params[i] })), async entry => {
    if (entry.params.status !== 'success') throw new Error('Unknown Lista market');
    const p = entry.params.result;
    const matching = targets.filter(t => t.supplies.includes((t.borrowed ? p.collateralToken : p.loanToken).toLowerCase()) && (!t.borrowed || t.borrows.includes(p.loanToken.toLowerCase())));
    if (!matching.length) return [];
    const [quote, whitelist, broker, oraclePrice] = await Promise.all([
      rates.marketQuote(entry.id), client.readContract({ address: deployment.core, abi: listaAccessAbi, functionName: 'getWhiteList', args: [entry.id], blockNumber: block }),
      client.readContract({ address: deployment.core, abi: listaAccessAbi, functionName: 'brokers', args: [entry.id], blockNumber: block }),
      client.readContract({ address: deployment.core, abi: morphoCoreAbi, functionName: 'getPrice', args: [p], blockNumber: block }),
    ]);
    if (whitelist.length || broker.toLowerCase() !== zero || oraclePrice <= 0n) return [];
    if (quote.state.totalSupplyAssets < quote.state.totalBorrowAssets) throw new Error('Invalid Lista liquidity');
    const info = await tokenMetadata(client, p.loanToken, block);
    const liquidity = liquidityQuote(quote.state.totalSupplyAssets - quote.state.totalBorrowAssets, info.decimals, info.symbol, p.loanToken, 'Lista Moolah accrued market supplied loan assets minus borrowed loan assets. Collateral TVL is excluded; provider routes and minimum loan amounts may restrict borrowing.');
    return matching.map(t => ({ ...option(t, 'Lista DAO', network, block, entry.id, `Moolah market ${entry.id.slice(0, 10)}…`, t.borrowed ? 0 : quote.apr, t.borrowed ? quote.borrowApr : null, t.borrowed ? Number(p.lltv) / 1e18 : null, 'Verified Lista Moolah market and oracle. Current protocol APR excludes LISTA rewards and intrinsic yield. Whitelisted and broker-only markets are excluded. Provider routes and minimum loan sizes may apply.'), url: listaUrl(network, entry.id), liquidity: t.borrowed ? liquidity : null }));
  }, warn);
  const vaults = await limited(catalog.vaults.filter(v => targets.some(t => !t.borrowed && t.supplies.includes(v.asset.toLowerCase()))), async v => {
    const [registered, core, asset, whitelist, capacity] = await Promise.all([
      isLegacyListaVault(network, v.address, v.asset) ? Promise.resolve(true) : client.readContract({ address: deployment.factory, abi: morphoFactoryAbi, functionName: 'isMoolahVault', args: [v.address], blockNumber: block }),
      client.readContract({ address: v.address, abi: morphoVaultAbi, functionName: 'MOOLAH', blockNumber: block }),
      client.readContract({ address: v.address, abi: morphoVaultAbi, functionName: 'asset', blockNumber: block }),
      client.readContract({ address: v.address, abi: listaAccessAbi, functionName: 'getWhiteList', blockNumber: block }),
      client.readContract({ address: v.address, abi: listaAccessAbi, functionName: 'maxDeposit', args: [zero], blockNumber: block }),
    ]);
    if (!registered || core.toLowerCase() !== deployment.core.toLowerCase() || asset.toLowerCase() !== v.asset.toLowerCase()) throw new Error('Wrong Lista vault');
    if (whitelist.length || capacity === 0n) return [];
    const rate = await rates.vault(v.address, 1, asset); if (rate.apr === null) throw new Error('Unknown Lista vault rate');
    return targets.filter(t => !t.borrowed && t.supplies.includes(v.asset.toLowerCase())).map(t => ({ ...option(t, 'Lista DAO', network, block, v.address, v.name, rate.apr!, null, null, listaNote(rate.note)), url: listaUrl(network, v.address, true) }));
  }, warn);
  return [...markets.flat(), ...vaults.flat()];
};
