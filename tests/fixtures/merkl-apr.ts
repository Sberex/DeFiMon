import type { MerklOpportunity, MerklRewards, Portfolio } from '../../src/types';
// Public identities/rates supplied by the user from Merkl. Campaign windows below are synthetic.
export const wallet = '0x5929D94eb4C41D91955154465a58a531Ad4CF7b8';
export const vault = '0x6E0cDB09eb33cD3894C905E0DFF9289b95a86FFF';
export const hub = '0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9';
export const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
export const gho = '0xb77E872A68C62CfC0dFb02C067Ecc3DA23B4bbf3';
export const usdt0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
export const netRules: NonNullable<MerklOpportunity['rules']> = { kind: 'aave-v4-net-borrow', hubs: [{ address: hub, borrowAssets: [{ id: '5', token: usdc }], supplyAssets: [{ id: '4', token: usdt }, { id: '5', token: usdc }] }] };
export const opportunities: MerklOpportunity[] = [
  { id: '13158230964923482281', chainId: 1, protocol: 'aave', type: 'AAVE_V4_HUB_NET_BORROWING', action: 'BORROW', identifier: '78146c09dd5ee539', name: 'Borrow USDC on Aave V4', tokens: [usdc], apr: .017499999997557942, status: 'ready', rules: netRules },
  { id: '17442523260684284660', chainId: 9745, protocol: 'fluid', type: 'FLUIDVAULT_BORROW', action: 'BORROW', identifier: vault, name: 'Borrow GHO-USDT0 from Fluid vault', tokens: [gho, usdt0], apr: .014494015001448777, status: 'ready', rules: { kind: 'fluid-vault', vault } },
  { id: '1682296689571099010', chainId: 9745, protocol: 'fluid', type: 'FLUIDVAULT_COLLATERAL', action: 'LEND', identifier: vault, name: 'Lend GHO-USDT0 on Fluid vault', tokens: [gho, usdt0], apr: .01319082936421783, status: 'ready', rules: { kind: 'fluid-vault', vault } },
];
export function rewards(): MerklRewards { return { address: wallet, status: 'ok', updatedAt: new Date().toISOString(), networks: [], aprStatus: 'ok', opportunities: structuredClone(opportunities) }; }
export function portfolio(): Portfolio {
  const asset = (address: string, symbol: string, supplied: number, borrowed: number, supply: number, borrow: number) => ({ address, symbol, supplied, borrowed, priceUsd: 1, collateral: supplied > 0, liquidationThreshold: .9, liquidationPriceUsd: null, supplyRate: { apr: supply, note: '' }, borrowRate: { apr: borrow, note: '' } });
  return { address: wallet, chain: 'Ethereum + Plasma + Arbitrum', blockNumber: null, updatedAt: new Date().toISOString(), protocols: [
    { id: 'aave-v4', name: 'Aave v4', chain: 'Ethereum', status: 'ok', coverage: 'Synthetic APR matching fixture', positions: [{ id: 'aave-v4-main', label: 'Aave V4 MAIN', suppliedUsd: 4000, debtUsd: 10000, healthFactor: .36, risk: 'liquidatable', notes: [], assets: [
      { ...asset(usdc, 'USDC', 0, 10000, .02, .06), v4Reserves: [{ hub, assetId: '5', supplied: 0, borrowed: 10000 }] },
      { ...asset(usdt, 'USDT', 4000, 0, .02, .06), v4Reserves: [{ hub, assetId: '4', supplied: 4000, borrowed: 0 }] },
    ] }] },
    { id: 'fluid', name: 'Fluid', chain: 'Plasma', status: 'ok', coverage: 'Synthetic APR matching fixture', positions: [{ id: 'fluid-nft-1', marketAddress: vault, label: 'Vault · GHO-USDT0 / GHO-USDT0 · NFT 1', suppliedUsd: 10000, debtUsd: 8000, healthFactor: 1.125, risk: 'watch', notes: [], assets: [asset(gho, 'GHO', 6000, 5000, .04, .06), asset(usdt0, 'USDT0', 4000, 3000, .03, .05)] }] },
  ] };
}
export function rawOpportunity(index: number) {
  const op = opportunities[index];
  return { opportunity: { ...op, status: 'LIVE', protocol: { id: op.protocol }, apr: op.apr * 100, tokens: op.tokens.map(address => ({ address, chainId: op.chainId, type: 'TOKEN', isTest: false })) } };
}
export function detail(index: number, now = Date.now() / 1000) {
  const op = opportunities[index];
  return { id: op.id, type: op.type, chainId: op.chainId, identifier: op.identifier, campaigns: [{ opportunityId: op.id, computeChainId: op.chainId, type: op.type, startTimestamp: now - 60, endTimestamp: now + 3600, rewardToken: { type: 'TOKEN', isTest: false }, params: { computeScoreParameters: { computeMethod: 'genericTimeWeighted' }, hooks: [], whitelist: [], blacklist: [], forwarders: [], forwardingList: [], hubs: [{ hubAddress: hub, assets: [{ assetId: '5', underlyingToken: usdc }, { assetId: '4', underlyingToken: usdt }], borrowAssetIds: ['5'], supplyAssetIds: ['4', '5'] }] } }] };
}
