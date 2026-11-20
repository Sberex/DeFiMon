import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('rejects the missing opening brace from the failed Render deploy before building or starting the server', () => {
  const root = mkdtempSync(join(tmpdir(), 'defimon-invalid-config-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    copyFileSync(new URL('../scripts/check-config.ts', import.meta.url), join(root, 'scripts/check-config.ts'));
    writeFileSync(join(root, 'config/token-matches.json'), '\n  "USDT": {"ethereum":"0xdac17f958d2ee523a2206206994597c13d831ec7"}\n}');
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/check-config.ts')], { encoding: 'utf8', timeout: 15000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid config/token-matches.json:');
    expect(result.stdout).not.toContain('Configuration valid');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20000);
