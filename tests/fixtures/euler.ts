import type { Address } from 'viem';
import type { NetworkId } from '../../src/types';
import type { ChainClient } from '../../server/rpc';
import { eulerDeployments } from '../../server/deployments/euler';
export const wallet = '0x1111111111111111111111111111111111111111' as Address;
export const subaccount = `0x${(BigInt(wallet) ^ 1n).toString(16).padStart(40, '0')}` as Address;
export const collateral = '0x2222222222222222222222222222222222222222' as Address;
export const debt = '0x3333333333333333333333333333333333333333' as Address;
export const deposit = '0x4444444444444444444444444444444444444444' as Address;
export const WETH = '0x5555555555555555555555555555555555555555' as Address;
export const USDC = '0x6666666666666666666666666666666666666666' as Address;
const ZERO = '0x0000000000000000000000000000000000000000';
const E6 = 10n ** 6n, E18 = 10n ** 18n;
export function eulerFixture(options: { network?: NetworkId; mainLoan?: boolean; noOwner?: boolean; badBalance?: boolean; badFactory?: boolean; oracleFailure?: boolean; rateFailure?: boolean; usdOracle?: boolean; collateralOracleFailure?: boolean; paused?: boolean; missingSlice?: boolean } = {}) {
  const network = options.network ?? 'ethereum', deployment = eulerDeployments[network], account = options.mainLoan ? wallet : subaccount;
  const vaults = [collateral, debt, deposit]; const calls: { name: string; address: string; args: readonly unknown[] }[] = [];
  const readContract = async ({ address, functionName, args = [], blockNumber }: any): Promise<any> => {
    if (blockNumber !== 321n) throw new Error('Wrong block');
    const a = address.toLowerCase(); calls.push({ name: functionName, address: a, args });
    switch (functionName) {
      case 'getProxyListLength': return 3n;
      case 'getProxyListSlice': return options.missingSlice ? [] : vaults.slice(Number(args[0]), Number(args[1]));
      case 'isProxy': return vaults.includes(args[0].toLowerCase()) && !(options.badFactory && args[0].toLowerCase() === collateral);
      case 'getAccountOwner': return options.noOwner ? ZERO : wallet;
      case 'getControllers': return args[0].toLowerCase() === account ? [debt] : [];
      case 'getCollaterals': return args[0].toLowerCase() === account ? [collateral] : [];
      case 'EVC': return deployment.evc;
      case 'asset': return a === collateral ? WETH : USDC;
      case 'name': return a === collateral ? 'Euler WETH collateral' : a === debt ? 'Euler USDC debt' : 'Euler USDC deposit';
      case 'symbol': return a === WETH ? 'WETH' : 'USDC';
      case 'decimals': return a === WETH ? 18 : 6;
      case 'balanceOf': {
        if (options.badBalance && a === deposit) throw new Error('private-provider-key');
        if (a === collateral && args[0].toLowerCase() === account) return 2n * E18;
        if (a === deposit && args[0].toLowerCase() === wallet) return 500n * E6;
        return 0n;
      }
      case 'convertToAssets': return args[0];
      case 'debtOf': return a === debt && args[0].toLowerCase() === account ? 1000n * E6 : 0n;
      case 'interestRate': if (options.rateFailure) throw new Error('private-provider-key'); return E18;
      case 'interestFee': return 1000;
      case 'cash': return 2000n * (a === collateral ? E18 : E6);
      case 'totalBorrows': return 1000n * (a === collateral ? E18 : E6);
      case 'caps': return [0, 0];
      case 'hookConfig': return [ZERO, options.paused ? 65 : 0];
      case 'LTVList': return a === debt ? [collateral] : [];
      case 'LTVBorrow': return args[0].toLowerCase() === collateral ? 7500 : 0;
      case 'LTVLiquidation': return args[0].toLowerCase() === collateral ? 8000 : 0;
      case 'accountLiquidity': if (options.oracleFailure) throw new Error('private-provider-key'); return [4800n * E18, 1000n * E18];
      case 'oracle': return deposit;
      case 'unitOfAccount': return '0x0000000000000000000000000000000000000348';
      case 'getQuote': if (options.collateralOracleFailure) throw new Error('private-provider-key'); return (args[1].toLowerCase() === WETH ? 3000n : 1n) * E18;
    }
    throw new Error(`Unexpected method ${functionName}`);
  };
  const client = { readContract, multicall: async ({ contracts, blockNumber }: any) => Promise.all(contracts.map(async (call: any) => {
    try { return { status: 'success', result: await readContract({ ...call, blockNumber }) }; }
    catch { return { status: 'failure', error: new Error('private-provider-key') }; }
  })) } as unknown as ChainClient;
  return { client, calls, prices: async () => new Map([[WETH, 3000], [USDC, 1]]) };
}
