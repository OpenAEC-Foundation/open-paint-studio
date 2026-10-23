import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
if (!process.env.RELEASE_KEY) throw new Error('PAINT_RELEASE_SIGNING_KEY is required for a signed build');
const dir = mkdtempSync(join(tmpdir(), 'paint-release-'));
function artifacts(path) { return readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? artifacts(join(path, e.name)) : /\.(deb|AppImage|exe|dmg)$/.test(e.name) ? [join(path, e.name)] : []); }
try {
  const key = join(dir, 'release.pem'); writeFileSync(key, process.env.RELEASE_KEY, { mode: 0o600 });
  const files = artifacts(process.argv[2] ?? 'src-tauri/target/release/bundle');
  if (!files.length) throw new Error('No build artifacts found');
  for (const file of files) {
    execFileSync(process.execPath, ['scripts/sign.mjs', file], { env: { ...process.env, PAINT_SIGNING_KEY_FILE: key }, stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/verify.mjs', file, `${file}.pub.pem`], { stdio: 'inherit' });
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
