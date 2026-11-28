import { expect, it, vi } from 'vitest';
import config from '../config/token-matches.json';
import { savingsCatalogAssets, savingsRateLink } from '../src/savings-catalog';
import { createSavingsCatalogReader } from '../server/savings-catalog';
import { configuredTokenRegistry } from '../server/token-registry';
import type { IntrinsicRate } from '../src/types';
it('lists every Savings stablecoin group once while preserving distinct same-symbol identities', () => {
  const expected=Object.entries(config).filter(([,g])=>g._category==='Savings stablecoin').map(([id])=>id).sort();
  expect(savingsCatalogAssets.map(a=>a.id).sort()).toEqual(expected); expect(new Set(savingsCatalogAssets.map(a=>a.id)).size).toBe(expected.length);
  expect(savingsCatalogAssets.find(a=>a.id==='sUSDai')?.safetyUrl).toBe('https://pharos.watch/stablecoin/susdai-usd-ai/');
  expect(savingsCatalogAssets.some(a=>a.id==='USDC')).toBe(false);
});
it('uses the same configured rate service with the correct oracle network, preserving negative and zero rates', async () => {
  const quote:IntrinsicRate={apr:-.02,estimated:true,note:'30-day observation',source:{chain:'Ethereum',oracle:'0x1111111111111111111111111111111111111111',kind:'erc4626',label:'Source'}};
  const load=vi.fn(async()=>quote),read=createSavingsCatalogReader(load);
  const result=await read('sUSDai');expect(result.quote?.apr).toBe(-.02);expect(load).toHaveBeenCalledWith('sUSDai',{network:configuredTokenRegistry.sUSDai.intrinsicOracles![0].network});
  quote.apr=0;expect((await read('sUSDai')).quote?.apr).toBe(0);
  await expect(read('USDC')).rejects.toThrow('Savings stablecoin');await expect(read('__proto__')).rejects.toThrow();
});
it('leaves missing intrinsic sources unavailable instead of using a pegged spot price or inventing zero income',async()=>{
  const load=vi.fn(),read=createSavingsCatalogReader(load),missing=savingsCatalogAssets.find(a=>a.sources.length===0)!;
  expect((await read(missing.id)).quote).toBeNull();expect(load).not.toHaveBeenCalled();
});
it('links the actual returned oracle or a published alternate source and safely falls back to configured contracts',()=>{
  const asset=savingsCatalogAssets.find(a=>a.id==='sUSDai')!;
  expect(savingsRateLink(asset)?.url).toContain('/address/'+asset.sources[0].address);
  const quote:IntrinsicRate={apr:.05,note:'Published staking APR',source:{chain:'Ethereum',oracle:'',kind:'lido',url:'https://lido.fi/',label:'Lido staking APR'}};
  expect(savingsRateLink(asset,quote)).toEqual({url:'https://lido.fi/',label:'Lido staking APR'});
  quote.source.url='javascript:alert(1)';expect(savingsRateLink(asset,quote)?.url).toContain('/address/');
});
