#!/usr/bin/env python3
"""Import CoinGecko ranks 1–2000 without replacing any existing contract mapping.

Public metadata is cached outside the repository. Without --apply this writes only
an audit preview in the cache directory. Review category decisions before applying.
"""
import argparse
import copy
import datetime
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = 'https://api.coingecko.com/api/v3/'
CATEGORIES = {'Other', 'Stablecoin', 'Savings stablecoin'}
CANONICAL = {1: 'ethereum', 42161: 'arbitrum', 9745: 'plasma', 8453: 'base', 56: 'bsc', 10: 'optimism', 137: 'polygon', 43114: 'avalanche', 100: 'gnosis', 324: 'zksync', 80094: 'berachain'}


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def valid_address(value):
    return isinstance(value, str) and bool(re.fullmatch('0x[0-9a-fA-F]{40}', value)) and int(value[2:], 16) != 0 and value.lower() != '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'


def request(url, path):
    if path.exists():
        return json.loads(path.read_text())
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DeFiMon public registry import'}), timeout=40) as response:
                value = json.load(response)
            dump(path, value)
            return value
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 5:
                raise
            delay = min(60, max(1, int(error.headers.get('Retry-After', '60'))))
            print(f'CoinGecko rate limit: retrying in {delay} seconds', flush=True)
            time.sleep(delay)
    raise ValueError('Metadata request failed')


def validate_ranking(rows):
    if len(rows) != 2000 or len({r['id'] for r in rows}) != 2000 or {r.get('market_cap_rank') for r in rows} != set(range(1, 2001)):
        raise ValueError('Expected exactly 2,000 distinct assets with ranks 1–2000; no config was written')
    if any(not isinstance(r.get('market_cap'), (float, int)) or r['market_cap'] <= 0 for r in rows):
        raise ValueError('Missing circulating market capitalization')
    return sorted(rows, key=lambda r: r['market_cap_rank'])


def resolve_platforms(platforms, existing, chains):
    """Only explicit EVM mainnet IDs from CoinGecko plus independent chain metadata."""
    registry = copy.deepcopy(existing)
    known = {c['chainId']: key for key, c in existing.items()}
    mainnets = {c['chainId']: c for c in chains if not re.search(r'test|devnet|localhost', c.get('name', ''), re.I)}
    result = {}
    for p in platforms:
        cid = p.get('chain_identifier')
        if not isinstance(cid, int) or cid <= 0 or re.search(r'test|devnet', p.get('name', ''), re.I):
            continue
        if cid not in known and cid not in mainnets:
            continue
        key = known.get(cid) or CANONICAL.get(cid) or re.sub('[^a-z0-9]+', '-', p['id'].lower()).strip('-')
        if key in registry and registry[key]['chainId'] != cid:
            continue
        registry.setdefault(key, {'chainId': cid, 'name': mainnets.get(cid, {}).get('name', p['name'])})
        result[p['id']] = key
    return result, registry


def merge(original, rows, coins, platform_keys, stable_ids, savings_ids, decisions):
    """Exact contract identity only. Existing values and capitalization win conflicts."""
    groups = copy.deepcopy(original)
    occupied = {(n, a.lower()): k for k, g in groups.items() for n, a in g.items() if not n.startswith('_')}
    report = {'ranking': [], 'conflicts': [], 'excludedPlatforms': [], 'additions': [], 'categoryChanges': [], 'sources': {}}
    by_id = {c['id']: c for c in coins}
    for row in rows:
        identity = row['id']
        if identity not in by_id:
            raise ValueError(f'CoinGecko platform list is missing ranked asset {identity}')
        addresses = {}
        for platform, address in by_id[identity].get('platforms', {}).items():
            if valid_address(address) and platform in platform_keys:
                network = platform_keys[platform]
                # Do not collapse distinct contracts under aliases for one chain.
                if network in addresses and addresses[network].lower() != address.lower():
                    report['conflicts'].append({'id': identity, 'network': network, 'reason': 'Multiple CoinGecko contracts on one chain; additional platform excluded', 'address': address})
                    continue
                addresses[network] = address.lower()
            elif address:
                report['excludedPlatforms'].append({'id': identity, 'platform': platform, 'reason': 'Not a verified nonzero EVM mainnet contract'})
        classification = decisions.get(identity)
        if isinstance(classification, dict):
            category, basis = classification['category'], classification['basis']
        elif identity in savings_ids:
            category, basis = 'Savings stablecoin', 'CoinGecko Yield-Bearing Stablecoin category'
        elif identity in stable_ids:
            category, basis = 'Stablecoin', 'CoinGecko Stablecoins category'
        else:
            category, basis = 'Other', 'No stablecoin classification in reviewed CoinGecko metadata'
        if isinstance(classification, dict) and classification.get('depegged') and category != 'Other':
            raise ValueError(f'Depegged assets must be Other: {identity}')
        if category not in CATEGORIES:
            raise ValueError(f'Unresolved category for {identity}')
        matches = {occupied[n, a] for n, a in addresses.items() if (n, a) in occupied}
        ranking = {'id': identity, 'rank': row['market_cap_rank'], 'symbol': row['symbol'], 'name': row['name'], 'marketCapUsd': row['market_cap'], 'hasVerifiedEvmContract': bool(addresses), 'groups': sorted(matches)}
        report['ranking'].append(ranking)
        if not addresses:
            continue
        evidence = {'provider': 'CoinGecko', 'id': identity, 'rank': row['market_cap_rank'], 'name': row['name'], 'url': 'https://www.coingecko.com/en/coins/' + identity, 'categoryBasis': basis}
        if len(matches) > 1:
            report['conflicts'].append({'id': identity, 'groups': sorted(matches), 'reason': 'CoinGecko links multiple existing identities; existing groups retained and new links skipped'})
            continue
        if matches:
            key = next(iter(matches))
        else:
            symbol = row['symbol'].upper()
            key = symbol if symbol not in groups else f'{symbol}#cg-{identity}'
            if key in groups:
                raise ValueError(f'New identity key already exists: {key}')
            groups[key] = {'_category': category}
        group = groups[key]
        ranking['groups'] = [key]
        # A user-confirmed depeg supersedes the historical category, never addresses.
        if matches and isinstance(classification, dict) and classification.get('depegged') and group.get('_category', 'Other') != 'Other':
            report['categoryChanges'].append({'group': key, 'from': group.get('_category', 'Other'), 'to': 'Other', 'basis': basis})
            group['_category'] = 'Other'
        for network, address in sorted(addresses.items()):
            old = group.get(network)
            if old:
                if old.lower() != address:
                    report['conflicts'].append({'id': identity, 'group': key, 'network': network, 'kept': old, 'rejected': address, 'reason': 'Existing config / CoinMarketCap has priority'})
                continue
            if (network, address) in occupied:
                raise ValueError('Ambiguous existing contract identity')
            group[network] = address
            occupied[network, address] = key
            report['additions'].append({'group': key, 'network': network, 'address': address, 'coingeckoId': identity})
        report['sources'][key] = {**evidence, 'category': group.get('_category', 'Other'), 'existingCategoryPreserved': bool(matches)}
    return groups, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=pathlib.Path, default=pathlib.Path('/tmp/defimon-cg2000'))
    parser.add_argument('--decisions', type=pathlib.Path, default=ROOT / 'config/coingecko-category-overrides.json')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    cache = args.cache_dir
    rows = validate_ranking(sum((request(API + f'coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}&sparkline=false', cache / f'markets-{page}.json') for page in range(1, 9)), []))
    coins = request(API + 'coins/list?include_platform=true', cache / 'coins-list.json')
    platforms = request(API + 'asset_platforms', cache / 'platforms.json')
    chains = request('https://chainid.network/chains.json', cache / 'chain-list.json')
    stable, savings = [], []
    for category, collection in [('stablecoins', stable), ('yield-bearing-stablecoins', savings)]:
        page = 1
        while True:
            name = f'category-{category}' + (f'-{page}' if page > 1 else '')
            batch = request(API + f'coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}&sparkline=false&category={category}', cache / (name + '.json'))
            collection.extend(batch)
            if len(batch) < 250 or (batch[-1].get('market_cap') or 0) < min(r['market_cap'] for r in rows):
                break
            page += 1
            if page > 20:
                raise ValueError('Category pagination exceeded limit')
    decisions = json.loads(args.decisions.read_text())
    pending = decisions.get('pending', [])
    if pending:
        raise ValueError('Category confirmation is still required: ' + ', '.join(pending))
    original = json.loads((ROOT / 'config/token-matches.json').read_text())
    registry = json.loads((ROOT / 'config/evm-chains.json').read_text())
    platform_keys, expanded_registry = resolve_platforms(platforms, registry, chains)
    groups, report = merge(original, rows, coins, platform_keys, {r['id'] for r in stable}, {r['id'] for r in savings}, decisions['assets'])
    # Retain only newly verified platforms actually used by an imported token.
    used = {n for g in groups.values() for n in g if not n.startswith('_')}
    expanded_registry = {k: v for k, v in expanded_registry.items() if k in registry or k in used}
    seen = set()
    for group in groups.values():
        assert group.get('_category', 'Other') in CATEGORIES
        for network, address in group.items():
            if network.startswith('_'):
                continue
            assert network in expanded_registry and valid_address(address)
            assert (network, address.lower()) not in seen
            seen.add((network, address.lower()))
    report.update({'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'selection': 'CoinGecko market-cap ranks 1–2000; verified EVM mainnet contracts only; existing contract data has priority', 'rankedAssetsChecked': len(rows), 'rankedAssetsWithVerifiedEvmContracts': sum(r['hasVerifiedEvmContract'] for r in report['ranking']), 'newGroups': len(groups) - len(original), 'newContracts': len(report['additions']), 'groups': len(groups), 'contracts': len(seen), 'evmChains': len(expanded_registry), 'categoryCounts': {c: sum(g.get('_category', 'Other') == c for g in groups.values()) for c in sorted(CATEGORIES)}, 'rankingUrl': API + 'coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page={page}', 'platformsUrl': API + 'asset_platforms', 'contractListUrl': API + 'coins/list?include_platform=true', 'categoryDecisions': str(args.decisions.relative_to(ROOT)) if args.decisions.is_relative_to(ROOT) else args.decisions.name})
    dump(cache / 'import-preview.json', report)
    dump(cache / 'token-matches-preview.json', groups)
    if args.apply:
        dump(ROOT / 'config/token-matches.json', groups)
        dump(ROOT / 'config/evm-chains.json', dict(sorted(expanded_registry.items())))
        dump(ROOT / 'config/token-matches.coingecko.sources.json', report)
        cmc_path = ROOT / 'config/token-matches.sources.json'
        cmc = json.loads(cmc_path.read_text())
        for key in ['groups', 'contracts', 'evmChains', 'categoryCounts']:
            cmc[key] = report[key]
        dump(cmc_path, cmc)
    print(json.dumps({k: report[k] for k in ['rankedAssetsChecked', 'rankedAssetsWithVerifiedEvmContracts', 'newGroups', 'newContracts', 'groups', 'contracts', 'categoryCounts']}, indent=2))
    print('Applied' if args.apply else 'Preview only; no repository config changed')


if __name__ == '__main__':
    main()
