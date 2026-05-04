---
name: Bug report
about: Something isn't working
title: "[Bug] "
labels: bug
---

## What happened

<!-- A clear description of the bug. -->

## Reproduction

<!-- The minimum code that triggers the bug. Copy-paste-runnable is ideal. -->

```ts
import { Langos } from '@datacline/langos-sdk-node';
const client = new Langos({ apiKey: '...' });

// ...
```

## What you expected

<!-- What should have happened instead. -->

## What actually happened

<!-- The actual output, error message, or behavior. Include the full stack trace if it threw. -->

```
<paste error here>
```

## Environment

- SDK version: <!-- e.g. `0.2.0-alpha.1` (from `node_modules/@datacline/langos-sdk-node/package.json`) -->
- Node version: <!-- output of `node --version` -->
- OS: <!-- macOS / Linux / Windows -->
- Module system: <!-- ESM / CJS -->

## Anything else?

<!-- Logs, screenshots, related issues, attempts you've made. -->
