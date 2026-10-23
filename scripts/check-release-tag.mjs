import { readFileSync } from 'node:fs';
// Release tags follow vYYYY.WW.N: ISO year and week, then a patch counter for that week.
const [tag] = process.argv.slice(2);
if (!tag || !/^v\d{4}\.\d{1,2}\.\d+$/.test(tag)) throw new Error('Usage: node scripts/check-release-tag.mjs vYYYY.WW.N');
const read = path => readFileSync(path, 'utf8');
const versions = {
  'package.json': JSON.parse(read('package.json')).version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': read('src-tauri/Cargo.toml').match(/^version = "(.+)"/m)?.[1],
  'shared/version.ts': read('shared/version.ts').match(/releaseVersion = '(.+)'/)?.[1],
};
const mismatched = Object.entries(versions).filter(([, version]) => `v${version}` !== tag);
if (mismatched.length) throw new Error(`Tag ${tag} does not match ${mismatched.map(([file, version]) => `${file} (${version})`).join(', ')}`);
console.log(`Tag ${tag} matches the app version in ${Object.keys(versions).join(', ')}.`);
