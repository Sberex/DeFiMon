import { parseAbi, type Address } from 'viem';
import { fluidMarketAbi } from './abis/fluid-markets.js';
import { lendingResolverAbi } from './abis/fluid.js';
import { networks } from './networks.js';
import { fluidLendingRate, applyFluidRates } from './fluid-rates.js';
import { limited, normalizeMarketToken, option, type Reader } from './market-readers.js';
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
    const relevant = targets.filter(t => t.borrowed && suppliesRequired.some(a => t.supplies.includes(a)) && borrowsRequired.some(a => t.borrows.includes(a)) && suppliesRequired.every(a => t.allSupplies.includes(a)) && borrowsRequired.every(a => t.allBorrows.includes(a)));
    if (!relevant.length || vault.configs.collateralFactor === 0) return [];
    const makeAsset = (address: string, supplied: number, borrowed: number): Asset => ({ address, symbol: '', supplied, borrowed, priceUsd: null, collateral: supplied > 0, liquidationThreshold: null, liquidationPriceUsd: null });
    const supplies = suppliesRequired.map(a => makeAsset(a, 1, 0)), borrows = borrowsRequired.map(a => makeAsset(a, 0, 1));
    await applyFluidRates(client, config.dex, block, vault, supplies, borrows);
    return relevant.flatMap(t => {
      const sr = supplies.find(a => t.supplies.includes(a.address))?.supplyRate?.apr;
      const br = borrows.find(a => t.borrows.includes(a.address))?.borrowRate?.apr;
      if (sr == null || br == null) { warn('Some Fluid vault rates are unavailable.'); return []; }
      return [option(t, 'Fluid', network, block, address, `Vault ${vault.constantVariables.vaultId}`, sr, br, vault.configs.liquidationThreshold / 10000, vault.isSmartCol || vault.isSmartDebt ? 'Smart-pool per-token interest component; excludes trading income. All required pool tokens must be maintained; only baskets present in the source loan are matched. Borrow fees, limits and liquidity can affect entry.' : 'Current T1 vault rates after magnifiers. Borrow fees, vault limits and available liquidity must be checked before moving a loan.')];
    });
  }, warn) : [];
  const deposits = targets.filter(t => !t.borrowed);
  const fTokens = deposits.length ? await client.readContract({ address: config.lending, abi: lendingResolverAbi, functionName: 'getAllFTokens', blockNumber: block }) : [];
  const lending = await limited([...fTokens], async (fToken: Address) => {
    const underlying = await client.readContract({ address: fToken, abi: tokenAbi, functionName: 'asset', blockNumber: block });
    const relevant = deposits.filter(t => t.supplies.includes(normalizeMarketToken(underlying, network)));
    if (!relevant.length || underlying.toLowerCase() === zero) return [];
    const rate = await fluidLendingRate(client, config.lending, fToken, block);
    if (rate.apr === null) { warn('Some Fluid lending rates are unavailable.'); return []; }
    return relevant.map(t => option(t, 'Fluid', network, block, fToken, 'Lending deposit', rate.apr!, null, null));
  }, warn);
  return [...vaults.flat(), ...lending.flat()];
};
