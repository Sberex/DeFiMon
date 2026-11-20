import { parseAbi, type Address, type Hex } from 'viem';
import type { ChainClient } from './rpc.js';
import type { InterestRate } from '../src/types.js';
import { rate, YEAR_SECONDS } from './rates.js';
// lista-dao/moolah@402a34a: IBroker, LendingBroker, BrokerMath and IRateCalculator.
export const listaBrokerAbi = parseAbi([
  'function MOOLAH() view returns(address)',
  'function MARKET_ID() view returns(bytes32)', 'function LOAN_TOKEN() view returns(address)', 'function COLLATERAL_TOKEN() view returns(address)',
  'function getUserTotalDebt(address) view returns(uint256)',
  'function userDynamicPosition(address) view returns((uint256 principal,uint256 normalizedDebt))',
  'function userFixedPositions(address) view returns((uint256 posId,uint256 principal,uint256 apr,uint256 start,uint256 end,uint256 lastRepaidTime,uint256 interestRepaid,uint256 principalRepaid)[])',
  'function rateCalculator() view returns(address)',

]);
const coreBrokerAbi = parseAbi(['function brokers(bytes32) view returns(address)']);
const calculatorAbi = parseAbi(['function getRate(address) view returns(uint256)', 'function brokers(address) view returns(uint256 currentRate,uint256 ratePerSecond,uint256 maxRatePerSecond,uint256 lastUpdated)']);
const RAY = 10n ** 27n;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export interface ListaBorrowQuote { debt: bigint; borrowRate: InterestRate }
/** Broker debt includes principal and accrued fixed/dynamic interest not stored in core shares. */
export async function listaBorrowQuote(client: ChainClient, core: Address, id: Hex, params: { loanToken: Address; collateralToken: Address }, wallet: Address, blockNumber: bigint): Promise<ListaBorrowQuote | null> {
  const broker = await client.readContract({ address: core, abi: coreBrokerAbi, functionName: 'brokers', args: [id], blockNumber });
  if (/^0x0{40}$/i.test(broker)) return null;
  const read = <N extends 'MOOLAH' | 'MARKET_ID' | 'LOAN_TOKEN' | 'COLLATERAL_TOKEN'>(functionName: N) => client.readContract({ address: broker, abi: listaBrokerAbi, functionName, blockNumber });
  const [actualCore, marketId, loan, collateral, debt, dynamic, fixed, block] = await Promise.all([
    read('MOOLAH'), read('MARKET_ID'), read('LOAN_TOKEN'), read('COLLATERAL_TOKEN'),
    client.readContract({ address: broker, abi: listaBrokerAbi, functionName: 'getUserTotalDebt', args: [wallet], blockNumber }),
    client.readContract({ address: broker, abi: listaBrokerAbi, functionName: 'userDynamicPosition', args: [wallet], blockNumber }),
    client.readContract({ address: broker, abi: listaBrokerAbi, functionName: 'userFixedPositions', args: [wallet], blockNumber }),
    client.getBlock({ blockNumber }),
  ]);
  if (!same(actualCore, core) || !same(marketId, id) || !same(loan, params.loanToken) || !same(collateral, params.collateralToken) || fixed.length > 128) throw new Error('Unverified Lista broker identity');
  let yearlyInterest = 0, principal = 0n;
  const terms: string[] = []; const seen = new Set<string>();
  for (const p of fixed) {
    if (seen.has(String(p.posId)) || p.principalRepaid > p.principal || p.apr < RAY || p.end < p.start || p.start > block.timestamp || p.lastRepaidTime < p.start || p.lastRepaidTime > block.timestamp) throw new Error('Invalid Lista fixed loan');
    seen.add(String(p.posId));
    const remaining = p.principal - p.principalRepaid; principal += remaining;
    const apr = Number(p.apr - RAY) / 1e27;
    // Fixed interest accrues on unrepaid principal, and stops at the contract's expiry.
    if (block.timestamp < p.end) yearlyInterest += Number(remaining) * apr;
    if (remaining > 0n) terms.push(`${(apr * 100).toFixed(2)}% fixed contract APR${block.timestamp >= p.end ? ' (expired; future fixed interest capped)' : ''}`);
  }
  if (dynamic.normalizedDebt > 0n) {
    const calculator = await client.readContract({ address: broker, abi: listaBrokerAbi, functionName: 'rateCalculator', blockNumber });
    const [index, config] = await Promise.all([
      client.readContract({ address: calculator, abi: calculatorAbi, functionName: 'getRate', args: [broker], blockNumber }),
      client.readContract({ address: calculator, abi: calculatorAbi, functionName: 'brokers', args: [broker], blockNumber }),
    ]);
    if (!config[3] || config[3] > block.timestamp || index < RAY || (config[1] !== 0n && config[1] < RAY)) throw new Error('Unverified Lista dynamic rate');
    const dynamicDebt = (dynamic.normalizedDebt * index + RAY - 1n) / RAY;
    principal += dynamic.principal;
    const apr = config[1] === 0n ? 0 : Number(config[1] - RAY) / 1e27 * YEAR_SECONDS;
    yearlyInterest += Number(dynamicDebt) * apr;
    terms.push(`${(apr * 100).toFixed(2)}% dynamic APR`);
  } else if (dynamic.principal > 0n) throw new Error('Invalid Lista dynamic debt');
  if (debt < principal || (debt > 0n && principal === 0n) || !Number.isFinite(yearlyInterest)) throw new Error('Invalid Lista total debt');
  const apr = debt === 0n ? 0 : yearlyInterest / Number(debt);
  return { debt, borrowRate: rate(apr, `Lista LendingBroker debt includes all accrued fixed and dynamic interest. ${terms.join('; ')}. Displayed APR is annual current interest divided by total current debt, so monthly interest charges fixed principal only and does not charge its accrued interest twice. Fixed interest stops at expiry. Refinancing/early-repayment penalties are excluded. Broker ${broker}.`, true) };
}
