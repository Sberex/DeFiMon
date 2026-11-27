import type { Address } from 'viem';
import type { NetworkId } from '../../src/types.js';
export interface CurveFactory {
  address: Address;
  version: 1 | 2;
  gaugeFactory?: Address;
}
// curvefi/curve-llamalend.js@d472168015e5e5db8a565a91fcedf224620dad8a, constants/aliases.ts.
// Current official SDK/API publish no LlamaLend deployment on Base, BSC or Plasma.
export const CURVE_FACTORIES: Record<NetworkId, CurveFactory[]> = {
  arc: [],
  ethereum: [
    { address: '0xeA6876DDE9e3467564acBeE1Ed5bac88783205E0', version: 1 },
    {
      address: '0x8f6B56EC5ddF1F2691a1059f1D3cd97Ac9EaB0bd',
      version: 2,
      gaugeFactory: '0x64e1a69732fAC63F6790b3d8a34C5D713cC623E6',
    },
  ],
  arbitrum: [
    { address: '0xcaEC110C784c9DF37240a8Ce096D352A75922DeA', version: 1 },
  ],
  base: [],
  bsc: [],
  plasma: [],
};
export const CURVE_NAME = 'Curve LlamaLend';
export const curveCoverage = (network: NetworkId) =>
  CURVE_FACTORIES[network].length
    ? 'Official LlamaLend factories: direct borrower positions and wallet/gauge-held lending vault shares, pinned to one block. Includes only the versions deployed on this chain; excludes crvUSD minting, Convex wrappers, managed accounts and unclaimed rewards. Curve soft-liquidation balances are included; band-based liquidation has no fixed LLTV.'
    : 'Curve publishes no verified LlamaLend factory on this network; no markets can be checked here.';
// curvefi/curve-frontend@0e05c2644ba12a8136af19285ccf31e4ad4cd623 MARKETS_ALERTS.Lend (deprecated/disabled markets are still discoverable for existing holders).
export const CURVE_DISABLED_CONTROLLERS = new Set([
  'ethereum:0xad444663c6c92b497225c6ce65fee2e7f78bfb86',
  'ethereum:0xeda215b7666936ded834f76f3fbc6f323295110a',
  'ethereum:0x09dbdeb3b301a4753589ac6df8a178c7716ce16b',
  'ethereum:0xd15d9797c4ecbf1c97c010327602bc51a09dfb95',
  'ethereum:0x89707721927d7aaeeee513797a8d6cbbd0e08f41',
  'ethereum:0x276b8c8873079eeaccf4dd241de14be92d733b45',
  'ethereum:0xcf3df6c1b4a6b38496661b31170de9508b867c8e',
  'ethereum:0xa5d9137d2a1ee912469d911a8e74b6c77503bac8',
  'ethereum:0xe438658874b0acf4d81c24172e137f0ee00621b8',
  'ethereum:0xdc8b1caf2e10de76fb67e82c2485e7d4fa098c53',
  'ethereum:0xdc5d5ee1223d4c8b7eac8e876793f2171e7e8deb',
  'ethereum:0x757c61d89bd0406bfcbb68178bbfae79eca46c0f',
  'ethereum:0x143985860efaeacb92db23e4b0c4d66be51b08d2',
  'ethereum:0x6f91f33ac7122f025b73206239cbc81606f022d4',
  'ethereum:0xc28c2fd809fc1795f90de1c9da2131434a77721d',
  'ethereum:0xd961b0da2b0fb04439c96b552777720b5fc551a0',
  'ethereum:0xb62b9272679d7a495d7e9698d8663f217224408a',
  'ethereum:0xe786af7faef857c8d850d648723eec0a27cd8581',
  'ethereum:0x5bfee37053d711f49a0acf5afed6496fa68dce32',
  'ethereum:0xbe0f8c48776c0433b2b778ae9c076c21683ebe7b',
  'ethereum:0xbcc9acd2e7934bb8b5d734416737694acdd9e25a',
  'ethereum:0xfa4f65b3dc477738ce8618e9145e1f0ad9e29034',
  'ethereum:0x3c1350aa6faff17c87bde2015bbb45100d37dad3',
  'ethereum:0xf8c27436b277734aaa726a8fd5e6d7dade0296c5',
  'arbitrum:0x7adcc491f0b7f9bc12837b8f5edf0e580d176f1f',
  'arbitrum:0x3e293db65c81742e32b74e21a0787d2936beedf7',
  'arbitrum:0x7a5a1c91daf5a41942f90b3f8a9c4d3526294c16',
  'arbitrum:0xae659ce8f2f23649e09e92d164244aa127a7a2c7',
  'arbitrum:0xf4e35f69d0bee1afc26ee73f12fa7fa220f16f40',
  'arbitrum:0x991bf50a34972227e681127d9127a1dc54f67a3b',
  'arbitrum:0x4153532eb32d57a1a08cd024c66e79635afc8e3a',
  'arbitrum:0x5a2b666e6f36cb0a17cf03c9feb421855ca9751d',
  'arbitrum:0x6c1cd25cc6320f992ede07f6a6e93810e8855bc2',
  'arbitrum:0x28c20590de7539c316191f413686dcf794d8898e',
  'arbitrum:0x4064ed6ae070f126f56c47c8a8cdd6b924668b5d',
  'arbitrum:0x5014ab37fca7201badec3c0d0f28dc7899cdc7d5',
  'arbitrum:0x398e6dd92df9f792d0107668871e6f49ebdfe028',
  'arbitrum:0x76709bc0da299ab0234eec51385e900922ae98f5',
  'arbitrum:0x83b85f3b08b5ee58de9ef9604e7eec087fccf130',
]);
export const CURVE_V1_CREATED_CUTOFF = Date.parse('2025-11-12T00:00:00Z');
