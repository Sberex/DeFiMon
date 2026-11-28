import { expect, it } from 'vitest';
import { loadPendleSafetyAssets, pendleSafetyMap, pendleSafetyMarket } from '../src/pendle-safety';
import { assetSafetySummary, parsePharosGrades, tokenSafety } from '../src/pharos-safety';
import type { Portfolio } from '../src/types';
const pt = '0x7f47c3e6b2c00fc4eb4d5ae50d0ab0ab6888eb4d', yt = '0x5cffcc9ddef0fdcf395e2ea24ca5ed5a12032706', usd3 = '0x056b269eb1f75477a8666ae8c7fe01b64dd55ecc', usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const raw = () => ({ address: '0x4a5067c3ff1abb7449244025b0e37feaf77d8e3e', chainId: 1, pt: { address: pt, chainId: 1 }, yt: { address: yt, chainId: 1 }, underlyingAsset: { address: usd3, chainId: 1, symbol: 'USD3' }, accountingAsset: { address: usdc, chainId: 1, symbol: 'USDC' } });
const feed = () => parsePharosGrades({ schemaVersion: 1, asOfSec: Math.floor(Date.now()/1000), publicationStatus: 'current', methodologyVersion: '10.58', grades: [{ id: 'usd3-3jane', grade: 'F', score: 20, ratingStatus: 'rated' }, { id: 'usdc-circle', grade: 'A+', score: 90, ratingStatus: 'rated' }] });
it('maps PT and YT to the exact USD3 underlying rather than their USDC accounting currency', () => {
  const market = pendleSafetyMarket(raw(), 1)!; const mapping = pendleSafetyMap([market]);
  expect(mapping.get(pt)?.address).toBe(usd3); expect(mapping.get(yt)?.address).toBe(usd3);
  const bases = new Map([...mapping].map(([token,base])=>[`Ethereum:${token}`,base]));
  for (const address of [pt, yt]) expect(tokenSafety('Ethereum', address, feed(), bases)).toMatchObject({ grade: 'F', inheritedFrom: 'USD3', url: 'https://pharos.watch/stablecoin/usd3-3jane/' });
  expect(tokenSafety('Ethereum', usd3, feed())?.grade).toBe('F'); expect(tokenSafety('Ethereum', usdc, feed())?.grade).toBe('A+');
  expect(tokenSafety('Base', pt, feed(), bases)).toBeUndefined();
  expect(tokenSafety('Ethereum', '0x1111111111111111111111111111111111111111', feed(), bases)).toBeUndefined();
});
it('does not invent a base from accountingAsset, a symbol, conflicting markets or the wrong token chain', () => {
  expect(pendleSafetyMarket({...raw(),underlyingAsset:undefined},1)).toBeNull();
  expect(()=>pendleSafetyMarket({...raw(),pt:{address:pt,chainId:8453}},1)).toThrow();
  const market=pendleSafetyMarket(raw(),1)!;
  expect(pendleSafetyMap([market,{...market,base:{address:usdc,chainId:1,symbol:'USDC'}}]).has(pt)).toBe(false);
});
it('moves PT/YT values into their base grade without merging their balances or adding them twice', () => {
  const map=pendleSafetyMap([pendleSafetyMarket(raw(),1)!]),bases=new Map([...map].map(([token,base])=>[`Ethereum:${token}`,base]));
  const p:Portfolio={address:pt,chain:'Ethereum',blockNumber:'1',updatedAt:new Date().toISOString(),protocols:[],wallets:[{chain:'Ethereum',status:'ok',coverage:'',pricedValueUsd:130,unpricedCount:0,tokens:[{address:pt,symbol:'PT-USD3',balance:100,priceUsd:1,valueUsd:100},{address:yt,symbol:'YT-USD3',balance:100,priceUsd:.1,valueUsd:10},{address:usd3,symbol:'USD3',balance:20,priceUsd:1,valueUsd:20}]}]};
  const s=assetSafetySummary(p,feed(),bases);expect(s.groups.map(g=>g.grade)).toEqual(['F']);expect(s.knownValueUsd).toBe(130);expect(s.groups[0].assets).toHaveLength(3);
});
it('loads the compact backend catalog or falls back to Pendle without accepting incomplete pages', async () => {
  const market=pendleSafetyMarket(raw(),1)!;
  expect((await loadPendleSafetyAssets('ethereum','/api/pendle-safety-assets/ethereum',async()=>new Response(JSON.stringify({chainId:1,markets:[market]})))).get(pt)?.address).toBe(usd3);
  const calls:string[]=[];
  const m=await loadPendleSafetyAssets('ethereum','/old-backend',async url=>{calls.push(String(url));return calls.length===1?new Response('',{status:404}):new Response(JSON.stringify({total:1,results:[raw()]}))});
  expect(calls[1]).toContain('/1/markets?');expect(m.get(yt)?.address).toBe(usd3);
  await expect(loadPendleSafetyAssets('ethereum',null,async()=>new Response(JSON.stringify({total:2,results:[raw()]})))).rejects.toThrow('Incomplete');
});
