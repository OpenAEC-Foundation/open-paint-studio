# Builds and signing

## Local build

`pnpm build` checks TypeScript, builds the frontend and emits the standalone service JavaScript. `pnpm tauri build --bundles deb,appimage` produces Linux installers. Windows NSIS and macOS DMG builds run on their respective platforms using `.github/workflows/build.yml`.

CI runs tests before the native build matrix on every push to `main` and on pull requests. It uploads artifacts to the workflow run; it does not publish a release.

## Releases

Versions follow `YYYY.WW.N`: the ISO year and week of the release, then a patch counter that starts at 0 each week. Week numbers have no leading zero (`2026.5.0`), because Cargo rejects them. The Git tag is the version with a `v` prefix, for example `v2026.43.2`.

1. Set the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `shared/version.ts`.
2. Commit, then push the tag: `git tag v2026.43.2 && git push origin v2026.43.2`.
3. `.github/workflows/release.yml` checks that the tag matches every version file, runs the tests and creates the draft release **OpenAEC Paint Studio v2026.43.2**. It uploads the Windows NSIS installer (current user), the universal macOS DMG, the Linux DEB and AppImage, and `SHA256SUMS`.
4. Write the release notes in the draft and publish it. The release stays a draft until someone publishes it.

The Windows installer embeds the WebView2 bootstrapper and installs the runtime silently when it is missing. `src-tauri/WebView2Loader.dll` is committed and installed next to the executable through `src-tauri/tauri.windows.conf.json`.

The tags `v0.1.0`, `2026.43` and `2026.43.1` predate this scheme.

## Detached release signing

Release authenticity uses Ed25519 signatures over a manifest containing filename, size and SHA-256. The private key is kept outside the repository.

Generate your release key once:

```sh
mkdir -p ~/.config/openaec-paint-studio
chmod 700 ~/.config/openaec-paint-studio
openssl genpkey -algorithm ED25519 -out ~/.config/openaec-paint-studio/release-private.pem
chmod 600 ~/.config/openaec-paint-studio/release-private.pem
openssl pkey -in ~/.config/openaec-paint-studio/release-private.pem -pubout -out release-public.pem
```

Do not replace an existing release key. Back up the private key securely. To sign and verify:

```sh
PAINT_SIGNING_KEY_FILE=~/.config/openaec-paint-studio/release-private.pem pnpm sign path/to/app.deb
pnpm verify path/to/app.deb release-public.pem
```

Distribute the artifact and its `.manifest.json`, `.sig` and `.pub.pem` files. Verification requires an independently trusted public key; downloading a public key from the same untrusted source as the binary does not establish publisher identity. This is artifact signing, not a trusted OS publisher certificate or Tauri automatic updater signature.

CI: add the PEM private key as `PAINT_RELEASE_SIGNING_KEY`, then run **Build and verify → sign=true**. Missing key material fails that signing step instead of producing a purportedly signed release. The release workflow signs the installers whenever this secret exists and uploads them without detached signatures when it does not. No private key is stored in CI artifacts.

## Native code signing

The build workflow supports these optional existing credentials:

- Windows: `WINDOWS_CERTIFICATE` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD`. Imports into the temporary runner certificate store and supplies the resulting thumbprint to Tauri's Authenticode signing configuration, using SHA-256 and a timestamp service.
- macOS: `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`; notarization additionally requires `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`.
- Without these credentials, Windows builds are unsigned and macOS builds use ad-hoc signing. Detached Ed25519 signatures do not remove SmartScreen/Gatekeeper warnings. No automatic updater is advertised or configured.

Platform setup: [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [GitHub builds](https://v2.tauri.app/distribute/pipelines/github/).
