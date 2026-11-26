import { sameTwoAssetBasket } from '../src/recommendation-filters.js';
import { parseAbi, type Address } from 'viem';
import { fluidMarketLiquidity } from './fluid-market-liquidity.js';
import { fluidMarketAbi } from './abis/fluid-markets.js';
import { lendingResolverAbi } from './abis/fluid.js';
import { networks } from './networks.js';
import { fluidLendingRate, applyFluidRates } from './fluid-rates.js';
import { matchesSupply, matchesBorrow, marketPair, limited, normalizeMarketToken, option, type Reader } from './market-readers.js';
import type { Asset } from '../src/types.js';
const tokenAbi = parseAbi(['function asset() view returns (address)']);
const zero = '0x0000000000000000000000000000000000000000';
export const readFluidMarkets: Reader = async (client, network, block, targets, warn) => {
  const config = networks[network].fluid;
  const addresses = await client.readContract({ address: config.vault, abi: fluidMarketAbi, functionName: 'getAllVaultsAddresses', blockNumber: block });
  if (addresses.length > 1000) throw new Error('Too many vaults');
  const vaults = targets.some(t => t.borrowed) ? await limited([...addresses], async address => {
    const vault = await client.readContract({ address: config.vault, abi: fluidMarketAbi, functionName: 'getVaultEntireData', args: [address], blockNumber: block });
    if (vault.vault.toLowerCase() !== address.toLowerCase()) throw new Error('Wrong vault');
    const suppliesRequired = [vault.constantVariables.supplyToken.token0, ...(vault.isSmartCol ? [vault.constantVariables.supplyToken.token1] : [])].map(a => normalizeMarketToken(a, network));
    const borrowsRequired = [vault.constantVariables.borrowToken.token0, ...(vault.isSmartDebt ? [vault.constantVariables.borrowToken.token1] : [])].map(a => normalizeMarketToken(a, network));
    if (!targets.some(t=>t.discovery) && vault.isSmartCol && vault.isSmartDebt && sameTwoAssetBasket(suppliesRequired, borrowsRequired)) return [];
    const relevant = targets.filter(t => t.borrowed && suppliesRequired.some(a => matchesSupply(t, a)) && borrowsRequired.some(a => matchesBorrow(t, a)) && (t.discovery || suppliesRequired.every(a => t.allSupplies.includes(a)) && borrowsRequired.every(a => t.allBorrows.includes(a))));
    if (!relevant.length || vault.configs.collateralFactor === 0) return [];
    const makeAsset = (address: string, supplied: number, borrowed: number): Asset => ({ address, symbol: '', supplied, borrowed, priceUsd: null, collateral: supplied > 0, liquidationThreshold: null, liquidationPriceUsd: null });
    const supplies = suppliesRequired.map(a => makeAsset(a, 1, 0)), borrows = borrowsRequired.map(a => makeAsset(a, 0, 1));
    await applyFluidRates(client, config.dex, block, vault, supplies, borrows);
    const liquidity = await fluidMarketLiquidity(client, network, block, vault);
    return relevant.flatMap(t => supplies.filter(a=>matchesSupply(t,a.address)).flatMap(sa=>borrows.filter(a=>matchesBorrow(t,a.address)).flatMap(ba=>{
      const sr=sa.supplyRate?.apr,br=ba.borrowRate?.apr;
      if(sr==null||br==null){warn('Some Fluid vault rates are unavailable.');return [];}
      return [{...option(marketPair(t,sa.address,ba.address),'Fluid',network,block,address,`Vault ${vault.constantVariables.vaultId}`,sr,br,vault.configs.liquidationThreshold/10000,vault.isSmartCol||vault.isSmartDebt?'Smart-pool per-token interest component; excludes trading income. The full listed collateral and debt token baskets must be maintained. Borrow fees, limits and liquidity can affect entry.':'Current T1 vault rates after magnifiers. Borrow fees, vault limits and available liquidity must be checked before moving a loan.'),liquidity:liquidity.get(ba.address)??null,url:`https://fluid.io/${networks[network].id}/borrowing/vaults/${vault.constantVariables.vaultId}`,...(t.discovery?{requiredTokens:{supplied:suppliesRequired,borrowed:borrowsRequired}}:{})}];
    })));
  }, warn) : [];
  const deposits = targets.filter(t => !t.borrowed);
  const fTokens = deposits.length ? await client.readContract({ address: config.lending, abi: lendingResolverAbi, functionName: 'getAllFTokens', blockNumber: block }) : [];
  const lending = await limited([...fTokens], async (fToken: Address) => {
    const underlying = await client.readContract({ address: fToken, abi: tokenAbi, functionName: 'asset', blockNumber: block });
    const relevant = deposits.filter(t => matchesSupply(t, normalizeMarketToken(underlying, network)));
    if (!relevant.length || underlying.toLowerCase() === zero) return [];
    const rate = await fluidLendingRate(client, config.lending, fToken, block);
    if (rate.apr === null) { warn('Some Fluid lending rates are unavailable.'); return []; }
    return relevant.map(t => option(marketPair(t,normalizeMarketToken(underlying,network)), 'Fluid', network, block, fToken, 'Lending deposit', rate.apr!, null, null));
  }, warn);
  return [...vaults.flat(), ...lending.flat()];
};
