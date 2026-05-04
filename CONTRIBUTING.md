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

## Tests are required

Every PR with a code change needs:

1. **Unit tests** in `test/unit/` — fast, no network, covers the new code path
2. **Integration test** in `test/integration/` if you touch an HTTP boundary
3. `tsc --noEmit` clean
4. `pnpm build` clean

CI runs all of the above. PRs that skip them won't get review attention.

## Bug reports

File an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) — GitHub will load it automatically when you click "New issue". **Repro steps that we can copy-paste are 10x more useful than a description of behavior.**

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
- Title format: `feat(sdk): ...`, `fix(sdk): ...`, `docs(sdk): ...`, `chore(sdk): ...`
- Reference any related issue: `Fixes #123`
- Keep the diff focused — no unrelated formatting changes.
- The [PR template](.github/PULL_REQUEST_TEMPLATE.md) walks through what to include — GitHub auto-fills it on new PRs.

## What we don't accept

- Adding runtime dependencies — this is a zero-dep SDK by design. Build-time deps are fine.
- Changes that require server changes without a coordinated server PR. Ping us first.
- Replacing camelCase / snake_case conventions, AsyncIterable cursor walking, or auto idempotency. These are intentional design choices — see the **For SDK contributors** section in [CLAUDE.md](./CLAUDE.md).

## License

By contributing, you agree your work is licensed under the same MIT license as the project.

## Questions?

Open a GitHub Discussion or email the team. We're happy to chat about an idea before you sink time into a PR.
