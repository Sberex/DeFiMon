// Shape verified against Merkl opportunity 699654958170586655 on 2026-11-27.
export const merklMarketNow = Date.parse('2026-11-27T09:00:00.000Z');
export const merklMarketPool = '0x925a2a7214ed92428b5b1b090f80b25700095e12';
export const merklMarketTokens = {
  usdt: '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb',
  gho: '0xb77e872a68c62cfc0dfb02c067ecc3da23b4bbf3',
  susde: '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2',
  debt: '0xcbbc427b5658672768e11bfda00879839db4785f',
  ausdt: '0x5d72a9d9a9510cd8cbdba12ac62593a58930a948',
  agho: '0xad571979b4245e163a7e2119eb4dfd94afdaebc5',
};
export function merklMarketProgram() {
  const t = merklMarketTokens;
  return {
    id: '699654958170586655',
    chainId: 9745,
    type: 'AAVE_NET_BORROWING',
    identifier: 'f740d3e02581e9c4',
    name: 'Borrow USDT0 on Aave',
    protocol: { id: 'aave' },
    status: 'LIVE',
    action: 'BORROW',
    apr: 0.7767649256875737,
    apy: 0.7797895708253579,
    aprRecord: { timestamp: String(Date.parse('2026-11-27T00:00:00Z') / 1000) },
    campaigns: [
      {
        opportunityId: '699654958170586655',
        computeChainId: 9745,
        type: 'AAVE_NET_BORROWING',
        subType: 0,
        startTimestamp: 1793282400,
        endTimestamp: 1796306400,
        isPrivate: false,
        hasOverrides: false,
        rewardToken: { type: 'TOKEN', isTest: false },
        params: {
          tokens: [
            { tokenAddress: t.debt, underlyingToken: t.usdt },
            { tokenAddress: t.ausdt, underlyingToken: t.usdt },
            { tokenAddress: t.agho, underlyingToken: t.gho },
          ],
          borrowingToken: t.debt,
          supplyTokens: [t.ausdt, t.agho],
          hooks: [],
          blacklist: [],
          whitelist: [],
          forwarders: [],
          forwardingList: [],
          forwardingEnabled: true,
          computeScoreParameters: { computeMethod: 'genericTimeWeighted' },
          distributionMethodParameters: {
            distributionMethod: 'DUTCH_AUCTION',
            distributionSettings: {},
          },
        },
      },
    ],
  };
}
