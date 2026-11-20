import { readFileSync } from 'node:fs';

// Validate server configuration before producing a deployable build. TypeScript
// alone does not parse JSON files loaded with readFileSync at runtime.
const files = ['token-matches.json', 'evm-chains.json'];
try {
  for (const file of files) {
    try {
      const value = JSON.parse(readFileSync(new URL(`../config/${file}`, import.meta.url), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
    } catch (error) {
      throw new Error(`Invalid config/${file}: ${error instanceof Error ? error.message : 'Unable to read JSON.'}`);
    }
  }
  const { configuredTokenRegistry } = await import('../server/token-registry.js');
  console.log(`Configuration valid: ${Object.keys(configuredTokenRegistry).length} token groups; EVM networks and contract identities checked.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Configuration validation failed.');
  process.exitCode = 1;
}
