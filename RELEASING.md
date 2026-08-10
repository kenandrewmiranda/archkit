# Releasing archkit

archkit ships as two artifacts that move together: the **npm package** (`@kenandrewmiranda/archkit` — scoped because the bare name `archkit` collides with an existing package; the CLI command is still `archkit`) and the **Claude Code plugin** (the same repo, via `.claude-plugin/`). A single version covers both — `scripts/check-version-sync.mjs` enforces that `package.json` and `.claude-plugin/plugin.json` agree.

## One-time setup

Publishing uses **npm Trusted Publishing (OIDC)**. There is no `NPM_TOKEN` and no npm secret in the repo — the workflow authenticates as its own GitHub OIDC identity, which also satisfies the account's `auth-and-writes` 2FA setting.

On npmjs.com, under the package's **Settings → Trusted Publisher**, register a GitHub Actions publisher bound to:

- **Organization / repository** — this repo
- **Workflow filename** — `release.yml`
- (no environment)

`release.yml` already requests `id-token: write`, which is all the workflow side needs. Provenance is generated automatically under OIDC.

### Two traps that will silently break publishing

1. **The publisher is bound to the workflow *filename*, not its display name.** The workflow's `name:` is `Release`, but the field npm wants is `release.yml`. Configuring it as `Release` — or renaming `release.yml` — breaks publishing until the publisher config is updated to match. This exact mismatch has bitten this repo before.
2. **Never add `registry-url` to the `actions/setup-node` step.** It makes setup-node write an `.npmrc` with `//registry.npmjs.org/:_authToken=…`, injecting a literal placeholder token when no token is supplied. npm then authenticates with that junk token and never performs the OIDC exchange, and the registry answers with a misleading `403 Forbidden - PUT` / `ENEEDAUTH`. Trusted Publishing requires that *no* `_authToken` be configured at all, and `registry.npmjs.org` is already the default registry.

Trusted Publishing also requires **Node >= 22.14.0 and npm >= 11.5.1**. The workflow pins `node-version: 22` and then runs `npm install -g npm@latest`, because Node 22 ships npm 10.x.

## Cutting a release

1. **Bump the version in both files** (they must match — `npm run check:versions` enforces it, and CI fails otherwise):
   - `package.json` → `version`
   - `.claude-plugin/plugin.json` → `version`
   - Keep `package-lock.json` in sync: `npm install --package-lock-only`
2. **Update `CHANGELOG.md`** with the new section.
3. **Run `npm run check:versions`** locally before committing.
4. **Commit, open a PR, merge to `main`** (CI runs `check:versions` + the full test suite on ubuntu and windows).
5. **Tag and push** from `main`:
   ```bash
   git tag v1.8.0      # must equal package.json version (the workflow verifies)
   git push origin v1.8.0
   ```
6. The **`Release` workflow** (`.github/workflows/release.yml`) then runs on the tag:
   - upgrades npm to `latest` (Trusted Publishing needs npm >= 11.5.1)
   - verifies the tag matches `package.json`
   - `check:versions` + `npm test`
   - `npm publish --access public` — provenance is automatic under OIDC, so no `--provenance` flag is passed

To re-run a failed publish, use **workflow_dispatch against the `vX.Y.Z` tag**, not `main`.

## Verifying locally before a release

```bash
npm run check:versions     # package.json == plugin.json
npm test                   # all tests/*/run.mjs suites
npm pack --dry-run         # inspect exactly what will be published (files whitelist)
```

The publishable surface is pinned by the `files` whitelist in `package.json` (`bin`, `src`, `skills`, `presets`, `CHANGELOG.md`) — tests, `.arch/`, and dev tooling are excluded.

## Plugin distribution

The Claude Code plugin is listed in a marketplace manifest (`.claude-plugin/marketplace.json`) served at `https://market.thearchkit.com/marketplace.json`. Plugin updates are driven by the `version` in `.claude-plugin/plugin.json` — bumping it (step 1 above) is what existing users pick up via `/plugin update`.
