"""Exercise identity conflicts and ranking validation before registry writes."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('coingecko_import', pathlib.Path(__file__).resolve().parents[1] / 'scripts/import-coingecko-tokens.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
A, B, C = ('0x' + char * 40 for char in ['a', 'b', 'c'])


def merge(original, platforms, decisions=None, stable=None, savings=None, symbol='test'):
    return module.merge(original, [{'id': 'test-token', 'symbol': symbol, 'name': 'Test', 'market_cap_rank': 1001, 'market_cap': 100}], [{'id': 'test-token', 'platforms': platforms}], {'ethereum': 'ethereum', 'arbitrum-one': 'arbitrum', 'base': 'base'}, stable or set(), savings or set(), decisions or {})


class CoinGeckoImport(unittest.TestCase):
    def test_keeps_existing_address_case_and_category_and_only_adds_missing_chains(self):
        original = {'TOKEN': {'_category': 'Stablecoin', 'ethereum': A.upper().replace('0X', '0x'), 'arbitrum': B}}
        groups, report = merge(original, {'ethereum': A, 'arbitrum-one': C, 'base': B}, savings={'test-token'})
        self.assertEqual(groups['TOKEN'], {**original['TOKEN'], 'base': B})
        self.assertEqual(original['TOKEN']['arbitrum'], B)
        self.assertEqual(report['conflicts'][0]['kept'], B)
        self.assertEqual(report['conflicts'][0]['rejected'], C)
        self.assertEqual(report['additions'], [{'group': 'TOKEN', 'network': 'base', 'address': B, 'coingeckoId': 'test-token'}])

    def test_preserves_safety_score_metadata_without_using_it_as_contract_identity(self):
        original = {'TOKEN': {'_category': 'Stablecoin', 'ethereum': A, 'Safety Score': 'https://pharos.watch/stablecoin/test-token/'}}
        groups, report = merge(original, {'ethereum': A, 'base': B})
        self.assertEqual(groups['TOKEN'], {**original['TOKEN'], 'base': B})
        self.assertEqual(report['conflicts'], [])

    def test_does_not_bridge_two_existing_identities(self):
        original = {'FIRST': {'ethereum': A}, 'SECOND': {'arbitrum': B}}
        groups, report = merge(original, {'ethereum': A, 'arbitrum-one': B, 'base': C})
        self.assertEqual(groups, original)
        self.assertEqual(report['additions'], [])
        self.assertEqual(len(report['conflicts']), 1)

    def test_same_symbol_is_not_identity_and_new_asset_has_a_distinct_key(self):
        groups, report = merge({'TEST': {'_category': 'Other', 'ethereum': A}}, {'ethereum': B}, stable={'test-token'})
        self.assertEqual(groups['TEST']['ethereum'], A)
        self.assertEqual(groups['TEST#cg-test-token'], {'_category': 'Stablecoin', 'ethereum': B})
        self.assertEqual(report['ranking'][0]['groups'], ['TEST#cg-test-token'])

    def test_only_confirmed_depeg_changes_existing_category_not_contracts(self):
        original = {'USD': {'_category': 'Stablecoin', 'ethereum': A}}
        decision = {'test-token': {'category': 'Other', 'basis': 'Confirmed depeg', 'depegged': True}}
        groups, report = merge(original, {'ethereum': A}, decisions=decision)
        self.assertEqual(groups['USD'], {'_category': 'Other', 'ethereum': A})
        self.assertEqual(report['categoryChanges'][0]['from'], 'Stablecoin')

    def test_filters_native_non_evm_and_zero_placeholders(self):
        groups, report = merge({}, {'solana': 'not-an-evm-address', 'ethereum': '0x' + '0' * 40, 'base': '0x' + 'e' * 40})
        self.assertEqual(groups, {})
        self.assertFalse(report['ranking'][0]['hasVerifiedEvmContract'])

    def test_missing_platform_identity_fails_instead_of_silent_exclusion(self):
        with self.assertRaisesRegex(ValueError, 'missing ranked asset'):
            module.merge({}, [{'id': 'absent'}], [], {}, set(), set(), {})

    def test_ranking_requires_exactly_ranks_one_through_two_thousand(self):
        rows = [{'id': str(i), 'market_cap_rank': i, 'market_cap': 2001 - i} for i in range(1, 2001)]
        self.assertEqual(len(module.validate_ranking(rows)), 2000)
        for invalid in [rows[:-1], rows[:-1] + [rows[0]], rows[:-1] + [{**rows[-1], 'market_cap_rank': 2001}]]:
            with self.assertRaises(ValueError):
                module.validate_ranking(invalid)

    def test_verifies_platform_chain_ids_and_rejects_testnets(self):
        platform, chains = module.resolve_platforms([{'id': 'ethereum', 'chain_identifier': 1, 'name': 'Ethereum'}, {'id': 'solana', 'chain_identifier': None, 'name': 'Solana'}, {'id': 'new-test', 'chain_identifier': 123, 'name': 'New Testnet'}, {'id': 'new-chain', 'chain_identifier': 55, 'name': 'New Chain'}], {'ethereum': {'chainId': 1, 'name': 'Ethereum'}}, [{'chainId': 123, 'name': 'New Testnet'}, {'chainId': 55, 'name': 'New Chain'}])
        self.assertEqual(platform, {'ethereum': 'ethereum', 'new-chain': 'new-chain'})
        self.assertEqual(chains['new-chain']['chainId'], 55)


if __name__ == '__main__':
    unittest.main()
