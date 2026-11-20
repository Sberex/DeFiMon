import { expect, it } from 'vitest';
import { listaBorrowQuote } from '../server/lista-broker';
import type { ChainClient } from '../server/rpc';
const core = '0x1111111111111111111111111111111111111111', broker = '0x2222222222222222222222222222222222222222', wallet = '0x3333333333333333333333333333333333333333', loanToken = '0x4444444444444444444444444444444444444444', collateralToken = '0x5555555555555555555555555555555555555555', calculator = '0x6666666666666666666666666666666666666666', id = `0x${'1'.repeat(64)}` as const;
const RAY = 10n ** 27n, UNIT = 10n ** 18n, YEAR = 31536000n;
function fixture(options: { dynamic?: boolean; mature?: boolean; wrongIdentity?: boolean; failure?: boolean; noBroker?: boolean; invalidFixed?: boolean } = {}) {
  const principal = 50000n * UNIT, debt = 50120n * UNIT;
  const client = {
    getBlock: async ({ blockNumber }: any) => { expect(blockNumber).toBe(123n); return { timestamp: options.mature ? 10000n : 1000n }; },
    readContract: async ({ address, functionName, blockNumber }: any) => {
      expect(blockNumber).toBe(123n);
      if (options.failure && functionName === 'getUserTotalDebt') throw new Error('private-provider');
      switch (functionName) {
        case 'brokers': return address === core ? options.noBroker ? '0x0000000000000000000000000000000000000000' : broker : [RAY, RAY + RAY / 10n / YEAR, RAY + RAY / YEAR, 100n];
        case 'MOOLAH': return options.wrongIdentity ? wallet : core;
        case 'MARKET_ID': return id;
        case 'LOAN_TOKEN': return loanToken;
        case 'COLLATERAL_TOKEN': return collateralToken;
        case 'getUserTotalDebt': return debt;
        case 'userDynamicPosition': return { principal: options.dynamic ? principal : 0n, normalizedDebt: options.dynamic ? principal : 0n };
        case 'userFixedPositions': return options.dynamic ? [] : [{ posId: 1n, principal, apr: RAY + 3n * RAY / 100n, start: 100n, end: 5000n, lastRepaidTime: 100n, interestRepaid: 0n, principalRepaid: options.invalidFixed ? principal + 1n : 0n }];
        case 'rateCalculator': return calculator;
        case 'getRate': return debt * RAY / principal;
      }
      throw new Error('Unexpected fixture method');
    },
  } as unknown as ChainClient;
  return { client, principal, debt };
}
it('reads full fixed broker debt but charges periodic interest on outstanding principal only', async () => {
  const f = fixture(), r = await listaBorrowQuote(f.client, core, id, { loanToken, collateralToken }, wallet, 123n);
  expect(r?.debt).toBe(f.debt); expect(r!.borrowRate.apr! * Number(f.debt) / 12 / 1e18).toBeCloseTo(125);
  expect(r!.borrowRate.note).toContain('3.00% fixed contract APR');
});
it('reads the dynamic rate calculator and applies the current per-second interest to accrued dynamic debt', async () => {
  const f = fixture({ dynamic: true }), r = await listaBorrowQuote(f.client, core, id, { loanToken, collateralToken }, wallet, 123n);
  expect(r?.debt).toBe(f.debt); expect(r?.borrowRate.apr).toBeCloseTo(.1);
});
it('does not extrapolate interest beyond a fixed loan’s verified maturity', async () => {
  const f = fixture({ mature: true }), r = await listaBorrowQuote(f.client, core, id, { loanToken, collateralToken }, wallet, 123n);
  expect(r?.debt).toBe(f.debt); expect(r?.borrowRate.apr).toBe(0); expect(r?.borrowRate.note).toContain('expired');
});
it.each([{ wrongIdentity: true }, { failure: true }, { invalidFixed: true }])('rejects unverifiable broker accounting: %j', async options => {
  const f = fixture(options);
  await expect(listaBorrowQuote(f.client, core, id, { loanToken, collateralToken }, wallet, 123n)).rejects.toThrow();
});
it('preserves ordinary core loans when no broker is configured', async () => {
  const f = fixture({ noBroker: true });
  expect(await listaBorrowQuote(f.client, core, id, { loanToken, collateralToken }, wallet, 123n)).toBeNull();
});
