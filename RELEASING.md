# Releasing archkit

archkit ships as two artifacts that move together: the **npm package** (`archkit`) and the **Claude Code plugin** (the same repo, via `.claude-plugin/`). A single version covers both — `scripts/check-version-sync.mjs` enforces that `package.json` and `.claude-plugin/plugin.json` agree.

## One-time setup

Add an **`NPM_TOKEN`** secret to the GitHub repo (Settings → Secrets and variables → Actions):

1. Create an npm **automation** access token at https://www.npmjs.com/settings/~/tokens (Automation type, so it bypasses 2FA in CI).
2. Add it as the repo secret `NPM_TOKEN`.

Provenance (`npm publish --provenance`) is signed via GitHub OIDC — no extra secret needed; the `release.yml` workflow already requests `id-token: write`.

## Cutting a release

1. **Bump the version in both files** (they must match — CI fails otherwise):
   - `package.json` → `version`
   - `.claude-plugin/plugin.json` → `version`
   - Keep `package-lock.json` in sync: `npm install --package-lock-only`
2. **Update `CHANGELOG.md`** with the new section.
3. **Commit, open a PR, merge to `main`** (CI runs `check:versions` + the full test suite on the PR).
4. **Tag and push** from `main`:
   ```bash
   git tag v1.8.0      # must equal package.json version (the workflow verifies)
   git push origin v1.8.0
   ```
5. The **`Release` workflow** (`.github/workflows/release.yml`) then runs on the tag:
   - verifies the tag matches `package.json`
   - `check:versions` + `npm test`
   - `npm publish --provenance --access public`

## Verifying locally before a release

```bash
npm run check:versions     # package.json == plugin.json
npm test                   # all tests/*/run.mjs suites
npm pack --dry-run         # inspect exactly what will be published (files whitelist)
```

The publishable surface is pinned by the `files` whitelist in `package.json` (`bin`, `src`, `skills`, `presets`, `CHANGELOG.md`) — tests, `.arch/`, and dev tooling are excluded.

## Plugin distribution

The Claude Code plugin is listed in a marketplace manifest (`.claude-plugin/marketplace.json`) served at `https://market.thearchkit.com/marketplace.json`. Plugin updates are driven by the `version` in `.claude-plugin/plugin.json` — bumping it (step 1 above) is what existing users pick up via `/plugin update`.
