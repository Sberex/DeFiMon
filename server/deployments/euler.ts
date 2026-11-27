import type { Address } from 'viem';
import type { NetworkId } from '../../src/types.js';
// euler-xyz/euler-interfaces@0ea27dcf23c31249857180a0753638c040c4df1b, addresses/{1,42161,9745,8453,56}/CoreAddresses.json.
export const eulerDeployments: Partial<Record<NetworkId, { evc: Address; eVaultFactory: Address }>> = {
  // euler-xyz/euler-interfaces@0ea27dc, addresses/56/CoreAddresses.json.
  bsc: { evc: '0xb2E5a73CeE08593d1a076a2AE7A6e02925a640ea', eVaultFactory: '0x7F53E2755eB3c43824E162F7F6F087832B9C9Df6' },
  base: { evc: '0x5301c7dD20bD945D2013b48ed0DEE3A284ca8989', eVaultFactory: '0x7F321498A801A191a93C840750ed637149dDf8D0' },
  "ethereum": {
    "evc": "0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383",
    "eVaultFactory": "0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e"
  },
  "arbitrum": {
    "evc": "0x6302ef0F34100CDDFb5489fbcB6eE1AA95CD1066",
    "eVaultFactory": "0x78Df1CF5bf06a7f27f2ACc580B934238C1b80D50"
  },
  "plasma": {
    "evc": "0x7bdbd0A7114aA42CA957F292145F6a931a345583",
    "eVaultFactory": "0x42388213C6F56D7E1477632b58Ae6Bba9adeEeA3"
  }
};
