# Branches and remotes

Two remotes: `origin` is the public repository; `private` is a private copy used for work in progress.

## Branches

| Branch | What it holds | Pushed to |
|---|---|---|
| `main` | releases | `origin` and `private` (`git push-main`) |
| `dev` | work that can become public | `private` |
| `modules` | `dev` plus optional modules that stay private | `private` |
| `core/*` | a piece of work for `dev`, started from `dev` | `private` |
| `mod/*` | a piece of work on optional modules, started from `modules` | `private` |

Flow:

```
core/* ──► dev ──► main
            │
            └──► modules ◄── mod/*
```

- `dev` is merged into `modules` regularly, so that the modules always run on the current core.
- `modules` is **never** merged into `dev` or `main`. A change made on `modules` that belongs to the core is
  redone on a `core/*` branch.

## Optional modules

The app looks for `modules/private.js` at start-up. Where the file exists it registers more features
(through `addFeatures`, the same fields as the built-in features) and their strings; where it does not,
the import fails quietly and nothing changes. The service worker caches it only when it is there.
Tests run on every branch: `cd tools && npm test`.

## Guards

Run `sh tools/setup-hooks.sh` once per clone. It installs the versioned hooks (`tools/hooks/`) and sets the
push targets (`remote.pushDefault = private`, `branch.main.pushRemote = origin`, alias `git push-main`).

- `pre-push` refuses any branch other than `main` (and any tag) to `origin`, and refuses a `main` that contains
  `modules/private.js` or `docs/private/`, or any path listed in `docs/private/private-paths` on the local
  `modules` branch.
- Before merging into `main`, run `tools/private-check.sh`: it lists the files that mention a term listed in
  `docs/private/private-terms` on the local `modules` branch. `pre-merge-commit` prints the same list during a
  merge commit into `main` (fast-forward merges skip it).
