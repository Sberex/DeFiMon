import { beforeAll, afterAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
let server:Server,base:string,fail=false,calls=0;
beforeAll(async()=>{
 server=createApp(undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,async group=>{calls++;if(fail)throw Error('private-provider-url');return {group,checkedAt:new Date().toISOString(),quote:{apr:.08,note:'Verified 30-day history',source:{chain:'Ethereum',oracle:'0x1111111111111111111111111111111111111111',kind:'erc4626'}}}}).listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));const a=server.address();if(!a||typeof a==='string')throw Error();base=`http://127.0.0.1:${a.port}`;
});
afterAll(()=>new Promise<void>(r=>server.close(()=>r())));
it('reads a configured savings rate without a wallet and rejects other categories',async()=>{
 const r=await fetch(`${base}/api/savings-stablecoins/sUSDai`,{headers:{Origin:'https://app.sberex.com'}});expect(r.status).toBe(200);expect(r.headers.get('access-control-allow-origin')).toBe('https://app.sberex.com');expect((await r.json()).quote.apr).toBe(.08);
 const before=calls;expect((await fetch(`${base}/api/savings-stablecoins/USDC`)).status).toBe(404);expect(calls).toBe(before);
});
it('isolates failures without leaking provider errors',async()=>{fail=true;const r=await fetch(`${base}/api/savings-stablecoins/sUSDai`);expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('private-provider-url')});
