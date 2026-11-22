import { expect, it, vi } from 'vitest';
import type { ProtocolResult } from '../src/types';
import { positionLinks } from '../src/position-links';
import { AAVE_HORIZON } from '../server/deployments/aave-horizon';
import type { ChainClient } from '../server/rpc';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../server/adapters/aave', () => ({ readAave: read }));
import { readAaveV3Markets } from '../server/adapters/aave-markets';
const wallet = '0xE16BE042f9433779909a972669bE3A2003956348', client = {} as ChainClient;
const result = (horizon: boolean): ProtocolResult => ({ id: 'aave-v3', name: 'Aave v3', status: 'ok', coverage: '', positions: [{
  id: horizon ? 'aave-horizon-main' : 'aave-main', label: horizon ? AAVE_HORIZON.label : 'Ethereum main market', marketAddress: horizon ? AAVE_HORIZON.pool : '0x1111111111111111111111111111111111111111',
  suppliedUsd: horizon ? 138500 : 3000, debtUsd: horizon ? 97200 : 0, healthFactor: horizon ? 1.14 : null, risk: horizon ? 'watch' : 'no-debt', assets: [], notes: [],
}] });
it('reads main and Horizon independently at one Ethereum block and retains separate position IDs and links', async () => {
  read.mockReset().mockImplementation(async (_c, _w, _b, _n, market) => result(!!market));
  const p = await readAaveV3Markets(client, wallet, 123n);
  expect(read.mock.calls).toEqual([[client, wallet, 123n, 'ethereum'], [client, wallet, 123n, 'ethereum', AAVE_HORIZON]]);
  expect(p).toMatchObject({ id: 'aave-v3', status: 'ok', balanceDiscoveryComplete: true });
  expect(p.positions.map(x => x.id)).toEqual(['aave-main', 'aave-horizon-main']);
  expect(p.positions.reduce((s, x) => s + x.suppliedUsd!, 0)).toBe(141500);
  expect(positionLinks(p.id, 'Ethereum', p.positions[1])[0]).toMatchObject({ address: AAVE_HORIZON.pool, url: 'https://app.aave.com/?marketName=proto_horizon_v3' });
});
it('keeps either successful market when the other fails, marking failed balances unknown without leaking provider details', async () => {
  for (const failHorizon of [true, false]) {
    read.mockReset().mockImplementation(async (_c, _w, _b, _n, market) => { if (!!market === failHorizon) throw Error('secret-provider-key'); return result(!!market); });
    const p = await readAaveV3Markets(client, wallet, 123n);
    expect(p.status).toBe('partial'); expect(p.balanceDiscoveryComplete).toBe(false);
    expect(p.positions.find(x => x.id === (failHorizon ? 'aave-main' : 'aave-horizon-main'))?.suppliedUsd).toBeGreaterThan(0);
    expect(p.positions.find(x => x.id === (failHorizon ? 'aave-horizon-main' : 'aave-main'))?.suppliedUsd).toBeNull();
    expect(JSON.stringify(p)).not.toContain('secret-provider-key');
  }
  read.mockReset().mockRejectedValue(Error('secret-provider-key'));
  expect((await readAaveV3Markets(client, wallet, 123n)).status).toBe('error');
});
it('does not query Ethereum Horizon on other networks', async () => {
  read.mockReset().mockResolvedValue(result(false));
  await readAaveV3Markets(client, wallet, 123n, 'arbitrum');
  expect(read).toHaveBeenCalledExactlyOnceWith(client, wallet, 123n, 'arbitrum');
});
