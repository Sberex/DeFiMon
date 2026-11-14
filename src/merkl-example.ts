import type { MerklRewards } from './types';
// Synthetic only; never used as a failed live lookup's fallback.
export const merklExample: MerklRewards = {
  address: '0x1111111111111111111111111111111111111111', updatedAt: '', status: 'ok', networks: [
    { chain: 'Ethereum', status: 'ok', unclaimedUsd: 75, pendingUsd: 10, rewards: [{ address: '0xc00e94cb662c3520282e6f5717214004a7f26888', symbol: 'COMP', decimals: 18, unclaimed: 1.5, pending: .2, unclaimedRaw: '1500000000000000000', pendingRaw: '200000000000000000', priceUsd: 50, unclaimedUsd: 75, pendingUsd: 10 }] },
    { chain: 'Plasma', status: 'ok', unclaimedUsd: 10, pendingUsd: 2, rewards: [{ address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', symbol: 'USDT0', decimals: 6, unclaimed: 10, pending: 2, unclaimedRaw: '10000000', pendingRaw: '2000000', priceUsd: 1, unclaimedUsd: 10, pendingUsd: 2 }] },
    { chain: 'Arbitrum', status: 'ok', unclaimedUsd: 10, pendingUsd: 2.5, rewards: [{ address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18, unclaimed: 20, pending: 5, unclaimedRaw: '20000000000000000000', pendingRaw: '5000000000000000000', priceUsd: .5, unclaimedUsd: 10, pendingUsd: 2.5 }] },
  ],
};
