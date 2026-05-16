# Contributing

Thanks for considering a contribution to `@datacline/langos-sdk-node`. Quick guide.

## Code of conduct

Be kind, be specific, assume good intent. Bug reports and PRs that include a clear repro and reasoning are always welcome.

## Setup

```bash
git clone https://github.com/datacline/langos-sdk-node.git
cd langos-sdk-node
pnpm install
pnpm test          # unit tests, ~1.5s
pnpm build         # tsup -> dist/{esm,cjs,types}
```

## Development workflow

See the **For SDK contributors** section in [CLAUDE.md](./CLAUDE.md) for the full layout, conventions, and tasks (adding a resource, regenerating docs, etc.).

### Regenerating types from OpenAPI

The OpenAPI spec (`openapi/v1-openapi.yaml`) is the source of truth for the API surface. TypeScript types are generated from this spec at build time, but are committed to git (`src/generated/paths.d.ts`) to keep the repo self-contained.

**To re-vendor the spec when the server API changes:**

1. Ensure you have a sibling checkout of `langos-ide` at `../langos-ide` (typical layout: `~/go/src/github.com/datacline/{langos-ide,langos-sdk-node}`)
2. Run the vendor script:
   ```bash
   pnpm run vendor:openapi
   ```
3. Regenerate the types:
   ```bash
   pnpm run generate
   ```
4. Verify the changes: `git diff openapi/` and `git diff src/generated/paths.d.ts`
5. Commit both files in your PR - **committed types are the source of truth for this repo**. CI does not regenerate them.

**Note:** The `vendor:openapi` script copies from a sibling `langos-ide` checkout. If you're not on a machine with that layout, you can manually copy `/opt/langos/codestream-app/server/docs/v1-openapi.yaml` (or from the monorepo) to `openapi/v1-openapi.yaml`.

## Tests are required

Every PR with a code change needs:

1. **Unit tests** in `test/unit/` - fast, no network, covers the new code path
2. **Integration test** in `test/integration/` if you touch an HTTP boundary
3. `tsc --noEmit` clean
4. `pnpm build` clean

CI runs all of the above. PRs that skip them won't get review attention.

## Bug reports

File an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) - GitHub will load it automatically when you click "New issue". **Repro steps that we can copy-paste are 10x more useful than a description of behavior.**

Minimum useful bug report:
- SDK version (`@datacline/langos-sdk-node` version from `package.json`)
- Node version (`node --version`)
- The code that triggered the bug (15 lines or fewer is ideal)
- What you expected vs what happened
- Stack trace if it threw

## Feature requests

Open an issue using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Tell us:
- The use case (the *why*, not just the *what*)
- Your current workaround
- A proposed API surface (rough TypeScript signature is fine)

## Pull requests

- One logical change per PR. If you find drive-by improvements, separate them.
- Title format: `feat(sdk): ...`, `fix(sdk): ...`, `docs(sdk): ...`, `chore(sdk): ...` (Conventional Commits)
- Use `feat!:` or `fix!:` to flag a breaking change (or add a `BREAKING CHANGE:` footer)
- Reference any related issue: `Fixes #123`
- Keep the diff focused, no unrelated formatting changes
- The [PR template](.github/PULL_REQUEST_TEMPLATE.md) walks through what to include, GitHub auto-fills it on new PRs

The PR title becomes the squash-merge commit subject. `release-please` reads these to compute the next version and to generate the CHANGELOG entry, so they matter.

## Releases

This repo uses [release-please](https://github.com/googleapis/release-please) to automate version bumps, CHANGELOG generation, git tagging, GitHub Releases, and npm publishing. You do not write CHANGELOG entries by hand.

### How it works

1. Every push to `main` triggers `.github/workflows/release-please.yml`.
2. The bot scans new commits since the last release tag, groups them by type (`feat`/`fix`/`feat!`/etc), and computes the next version per SemVer.
3. The bot opens (or updates) a pending "Release PR" titled `chore(main): release langos-sdk-node X.Y.Z` with the auto-generated CHANGELOG entries.
4. When you merge that Release PR, the bot creates the `vX.Y.Z` git tag.
5. The tag triggers `.github/workflows/release.yml` which builds, verifies the tarball, and runs `npm publish` with the appropriate dist-tag.

### Forcing a specific next version

To override what the bot would compute (e.g., to drop a prerelease suffix at a milestone, or to skip ahead to a chosen major), add a footer to one of your commits on `main`:

```
chore: <reason for the override>

Release-As: <target version>
```

The next Release PR will target that version regardless of what the commit types would imply. See [the release-please docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md#release-as) for the full footer format.

### What about the existing CHANGELOG.md?

The existing entries stay as the historical record. `release-please` appends new entries below the existing content. The first auto-generated entry will sit above the manual ones in the same file.

## What we don't accept

- Adding runtime dependencies - this is a zero-dep SDK by design. Build-time deps are fine.
- Changes that require server changes without a coordinated server PR. Ping us first.
- Replacing camelCase / snake_case conventions, AsyncIterable cursor walking, or auto idempotency. These are intentional design choices - see the **For SDK contributors** section in [CLAUDE.md](./CLAUDE.md).

## License

By contributing, you agree your work is licensed under the same MIT license as the project.

## Questions?

Open a GitHub Discussion or email the team. We're happy to chat about an idea before you sink time into a PR.
