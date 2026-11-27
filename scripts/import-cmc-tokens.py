#!/usr/bin/env python3
"""Import a dated CMC top-1000 snapshot; preserve configured addresses and never guess by ticker.
Public metadata only. Cached responses stay outside the repository; no API key is needed.
"""
import argparse
import concurrent.futures
import datetime
import json
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIST_URL = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=1000&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false'
DETAIL_URL = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id='
CATEGORIES = {'Stablecoin', 'Savings stablecoin', 'Other'}
# User-confirmed 2026-11-16. Category describes the asset, never a $1 price assumption.
OVERRIDES = {29256: 'Savings stablecoin', 7959: 'Savings stablecoin', 38330: 'Savings stablecoin',
             35976: 'Stablecoin', 22933: 'Stablecoin', 35721: 'Stablecoin', 19891: 'Stablecoin', 38562: 'Stablecoin', 7129: 'Other'}
DESCRIPTION_OVERRIDES = {38273: 'Stablecoin'}
# These requested savings examples are often outside CMC's circulating-cap ranking.
SUPPLEMENTS = {'re-protocol-reusd': ('reUSD', 'Savings stablecoin'), 'susds': ('sUSDS', 'Savings stablecoin'), 'savings-dai': ('sDAI', 'Savings stablecoin'),
               'ethena-staked-usde': ('sUSDe', 'Savings stablecoin'), 'susdai': ('sUSDai', 'Savings stablecoin'),
               'usds': ('USDS', 'Stablecoin'), 'usdai': ('USDai', 'Stablecoin')}
CANONICAL = {1: 'ethereum', 42161: 'arbitrum', 9745: 'plasma', 8453: 'base', 56: 'bsc', 10: 'optimism',
             137: 'polygon', 43114: 'avalanche', 100: 'gnosis', 324: 'zksync', 80094: 'berachain'}
# Names resolve missing CMC IDs only against an independent EVM-chain/platform registry.
ALIASES = {'okexchain': 'oktchain', 'metal': 'metall2',
           'morph': 'morphl2', 'plume': 'plumenetwork', 'immutablezkevm': 'immutablezkevm'}

def norm(v): return re.sub('[^a-z0-9]', '', str(v).lower())
def valid_address(v): return isinstance(v, str) and bool(re.fullmatch('0x[0-9a-fA-F]{40}', v)) and int(v[2:], 16) != 0 and v.lower() != '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
def slug(v): return re.sub('[^a-z0-9]+', '-', str(v).lower()).strip('-')
def dump(path, value): path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def request(url, file, refresh=False):
    if file.exists() and not refresh: return json.loads(file.read_text())
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DeFiMon public token registry import'})
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read(16_000_001)
            if len(raw) > 16_000_000: raise ValueError('Metadata response too large')
            value = json.loads(raw); file.parent.mkdir(parents=True, exist_ok=True); dump(file, value); return value
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    parser.add_argument('--refresh', action='store_true', help='Fetch a new ranking and detail snapshot instead of using the cache')
    args = parser.parse_args(); cache = args.cache_dir
    listing = request(LIST_URL, cache / 'defimon-cmc-list.json', args.refresh)
    rows = listing['data']['cryptoCurrencyList']
    if len(rows) != 1000 or len({r['id'] for r in rows}) != 1000 or {r['cmcRank'] for r in rows} != set(range(1, 1001)):
        raise ValueError('Expected exactly ranks 1 through 1000; refusing an incomplete ranking')
    chain_rows = request('https://chainid.network/chains.json', cache / 'defimon-evm-chains.json', args.refresh)
    platforms = request('https://api.coingecko.com/api/v3/asset_platforms', cache / 'defimon-cg-platforms.json', args.refresh)
    chains = {r['chainId']: r for r in chain_rows if not re.search(r'test|devnet|localhost', r['name'], re.I)}
    # Cross-check newer mainnets against the installed, lockfile-pinned viem definitions
    # and CoinGecko's explicit EVM chain identifiers (chain lists can lag new chains).
    viem_file = cache / 'defimon-viem-chains.json'
    if not viem_file.exists() or args.refresh:
        code = "import * as chains from 'viem/chains'; console.log(JSON.stringify(Object.values(chains).filter(c=>typeof c==='object'&&Number.isInteger(c.id)).map(c=>({chainId:c.id,name:c.name,testnet:!!c.testnet}))));"
        viem_file.parent.mkdir(parents=True, exist_ok=True)
        viem_file.write_text(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    for c in json.loads(viem_file.read_text()):
        if not c['testnet'] and not re.search(r'test|devnet|localhost', c['name'], re.I): chains[c['chainId']] = c
    for p in platforms:
        cid = p.get('chain_identifier')
        if isinstance(cid, int) and cid > 0 and cid not in chains and not re.search(r'test|devnet', p['name'], re.I):
            chains[cid] = {'chainId': cid, 'name': p['name']}
    ids_by_name = {}; cg_by_id = {}
    def remember(name, cid):
        if cid in chains: ids_by_name.setdefault(norm(name), set()).add(cid)
    for cid, chain in chains.items():
        remember(chain['name'], cid); remember(chain.get('shortName', ''), cid)
    for p in platforms:
        cid = p.get('chain_identifier')
        if isinstance(cid, int) and cid in chains:
            remember(p['id'], cid); remember(p['name'], cid); cg_by_id.setdefault(cid, p['id'])
    registry = {}; excluded = []; conflicts = []; sources = {}; covered_ids = set()
    config_file = ROOT / 'config/token-matches.json'; original = json.loads(config_file.read_text())
    groups = {k: dict(v) for k, v in original.items()}; occupied = {}
    for key, group in groups.items():
        for network, address in group.items():
            if not network.startswith('_') and network != 'Safety Score': occupied[(network, address.lower())] = key
        group.setdefault('_category', 'Savings stablecoin' if key == 'sUSDai' else 'Stablecoin' if key in ['USDC', 'USDT', 'GHO'] else 'Other')
    def chain_key(cid, label):
        key = CANONICAL.get(cid) or cg_by_id.get(cid) or slug(label)
        registry[key] = {'chainId': cid, 'name': chains[cid]['name']}
        return key
    for cid, key in CANONICAL.items():
        if cid in chains: chain_key(cid, key)
    def network_for(row):
        label = str(row.get('contractPlatform', '')); cid = row.get('contractChainId')
        if re.search(r'test|devnet', label, re.I): return None
        if isinstance(cid, int) and cid > 0:
            if cid not in chains: return None  # Do not silently turn a testnet ID into a mainnet contract.
            return chain_key(cid, label)
        candidates = ids_by_name.get(ALIASES.get(norm(label), norm(label)), set())
        return chain_key(next(iter(candidates)), label) if len(candidates) == 1 else None
    def add_asset(symbol, identity, addresses, category, evidence):
        assert category in CATEGORIES
        # Identify pre-existing groups by an exact network + contract, never by symbol alone.
        matches = {occupied[(n, a.lower())] for n, values in addresses.items() for a in values if (n, a.lower()) in occupied}
        preferred = symbol if symbol in matches else sorted(matches)[0] if len(matches) == 1 else None
        if len(matches) > 1 and preferred is None:
            conflicts.append({'asset': identity, 'reason': 'Multiple configured identities share CMC record', 'groups': sorted(matches)})
        key = preferred or (symbol if symbol not in groups else f'{symbol}#{identity}')
        group = groups.setdefault(key, {'_category': category})
        group['_category'] = category
        for network, values in sorted(addresses.items()):
            existing = group.get(network)
            free = [a for a in sorted(values) if (network, a.lower()) not in occupied]
            # Multiple contracts on one chain are distinct routes: keep separate groups,
            # rather than asserting that all wrappers are interchangeable cross-chain.
            if not existing and len(values) == 1 and len(free) == 1:
                group[network] = free.pop(); occupied[(network, group[network].lower())] = key
            for address in free:
                variant = f'{symbol}#{identity}-{network}-{address[2:10]}'
                groups[variant] = {'_category': category, network: address}
                occupied[(network, address.lower())] = variant
                sources[variant] = {**evidence, 'symbol': symbol, 'variant': True}
                conflicts.append({'asset': identity, 'network': network, 'reason': 'Additional same-chain contract kept separate', 'group': variant})
        if len(group) == 1:
            if key not in original: del groups[key]
        else:
            if key in sources and evidence['provider'] != sources[key]['provider']:
                sources[key]['supplement'] = evidence
            else: sources[key] = {**evidence, 'symbol': symbol}
    def detail(row):
        value = request(DETAIL_URL + str(row['id']), cache / 'defimon-cmc-details' / (str(row['id']) + '.json'), args.refresh)['data']
        if value.get('id') != row['id']: raise ValueError('CMC detail identity mismatch')
        return value
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        details = list(pool.map(detail, rows))  # All 1000 records must succeed before any config is written.
    for row, d in zip(rows, details):
        addresses = {}
        for contract in d.get('platforms', []):
            a = contract.get('contractAddress'); network = network_for(contract) if valid_address(a) else None
            if network: addresses.setdefault(network, set()).add(a.lower())
            elif valid_address(a): excluded.append({'cmcId': row['id'], 'platform': contract.get('contractPlatform'), 'chainId': contract.get('contractChainId'), 'reason': 'Not verified as an EVM mainnet'})
        # The listing's primary platform can expose a contract absent from detail.platforms.
        primary = row.get('platform', {})
        if valid_address(primary.get('token_address')):
            network = network_for({'contractPlatform': primary.get('name'), 'contractChainId': -1})
            if network: addresses.setdefault(network, set()).add(primary['token_address'].lower())
        if not addresses: continue
        covered_ids.add(row['id'])
        tags = set(row.get('tags', [])) | {t['slug'] for t in d.get('tags', [])}
        category = OVERRIDES.get(row['id'], DESCRIPTION_OVERRIDES.get(row['id'], 'Stablecoin' if 'stablecoin' in tags else 'Other'))
        add_asset(row['symbol'], str(row['id']), addresses, category, {'provider': 'CoinMarketCap', 'id': row['id'], 'rank': row['cmcRank'], 'name': row['name'], 'url': 'https://coinmarketcap.com/currencies/' + row['slug'] + '/', 'categoryBasis': 'User confirmed' if row['id'] in OVERRIDES else 'Reviewed CMC asset description' if row['id'] in DESCRIPTION_OVERRIDES else 'CMC stablecoin tag' if category == 'Stablecoin' else 'No stablecoin classification in CMC snapshot'})
    cg = request('https://api.coingecko.com/api/v3/coins/list?include_platform=true', cache / 'defimon-cg-list.json', args.refresh)
    platform_by_slug = {p['id']: p for p in platforms}
    for record in cg:
        if record['id'] not in SUPPLEMENTS: continue
        symbol, category = SUPPLEMENTS[record['id']]; addresses = {}
        for platform, a in record.get('platforms', {}).items():
            cid = platform_by_slug.get(platform, {}).get('chain_identifier')
            if valid_address(a) and cid in chains: addresses.setdefault(chain_key(cid, platform), set()).add(a.lower())
        if addresses: add_asset(symbol, 'cg-' + record['id'], addresses, category, {'provider': 'CoinGecko', 'id': record['id'], 'name': record['name'], 'url': 'https://www.coingecko.com/en/coins/' + record['id'], 'categoryBasis': 'User-requested example; supplement outside CMC top-1000 selection'})
    # Final uniqueness check also protects all manually preserved entries.
    seen = set()
    for key, g in groups.items():
        assert g['_category'] in CATEGORIES
        for n, a in g.items():
            if n.startswith('_') or n == 'Safety Score': continue
            assert n in registry and valid_address(a), (key, n, a)
            assert (n, a.lower()) not in seen, (key, n, a)
            seen.add((n, a.lower()))
    report = {'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'selection': 'CMC ranks 1–1000 by market capitalization, filtered to verified EVM mainnet contracts; existing manual groups and explicit savings examples retained',
              'rankingUrl': LIST_URL, 'detailUrlTemplate': DETAIL_URL + '{id}', 'chainRegistryUrls': ['https://chainid.network/chains.json', 'https://api.coingecko.com/api/v3/asset_platforms', 'https://github.com/wevm/viem/tree/main/src/chains/definitions'],
              'rankedAssetsChecked': 1000, 'rankedAssetsIncluded': len(covered_ids), 'ranking': [{'id': r['id'], 'rank': r['cmcRank'], 'symbol': r['symbol'], 'name': r['name'], 'included': r['id'] in covered_ids} for r in rows], 'rankedAssetsWithoutVerifiedEvmContracts': [{'id': r['id'], 'rank': r['cmcRank'], 'symbol': r['symbol']} for r in rows if r['id'] not in covered_ids],
              'groups': len(groups), 'contracts': len(seen), 'evmChains': len(registry), 'categoryCounts': {c: sum(g['_category'] == c for g in groups.values()) for c in sorted(CATEGORIES)},
              'sources': sources, 'excludedPlatforms': excluded, 'separateContractVariants': conflicts}
    dump(ROOT / 'config/evm-chains.json', dict(sorted(registry.items())))
    dump(config_file, groups)
    dump(ROOT / 'config/token-matches.sources.json', report)
    print(json.dumps({k: report[k] for k in ['rankedAssetsChecked', 'rankedAssetsIncluded', 'groups', 'contracts', 'evmChains', 'categoryCounts']}, indent=2))

if __name__ == '__main__': main()
