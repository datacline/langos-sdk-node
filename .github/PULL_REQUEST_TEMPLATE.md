## Summary

<!-- 1-3 lines. What this PR changes and why. Reference any related issue: `Fixes #123`. -->

## Changes

<!-- Bullet list of meaningful changes. -->

-

## Test plan

- [ ] `pnpm test` — unit tests pass
- [ ] `pnpm test:integration` — integration tests pass (if HTTP-touching)
- [ ] `tsc --noEmit` clean
- [ ] `pnpm build` clean (ESM + CJS + .d.ts)
- [ ] Added regression test that fails on main and passes with this change (if fixing a bug)
- [ ] Updated `docs/api/*.md` (if changing public surface)

## Breaking changes?

<!-- Yes / no. If yes, what breaks and how should consumers migrate? -->

## Server-side changes?

<!-- The SDK is paired with `codestream-app/server/services/customer/*` in the
     langos-ide monorepo. If this PR depends on server changes, link the PR. -->
