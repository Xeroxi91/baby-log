# Branches and remotes

Two remotes: `origin` is the public repository; `private` is a private copy used for work in progress.

## Branches

| Branch | What it holds | Pushed to |
|---|---|---|
| `main` | releases | `origin` and `private` (`git push-main`) |
| `dev` | work that can become public | `private` |
| `family` | `dev` plus optional modules that stay private: the stable build used by one family, deployed separately | `private` |
| `core/*` | a piece of work for `dev`, started from `dev` | `private` |
| `mod/*` | a piece of work on optional modules, started from `family` | `private` |

Flow:

```
core/* ──► dev ──► main
            │
            └──► family ◄── mod/*
```

- `dev` is merged into `family` regularly, so that the modules always run on the current core.
- `family` is **never** merged into `dev` or `main`. A change made on `family` that belongs to the core is
  redone on a `core/*` branch.
- `family` is the production branch of its own deployment (static files, no build step); other branches
  of the private remote may get preview deployments there.

## Backups between copies of the app

The JSON backup also carries what a feature keeps only on the phone (`localKeys` in the features list), never
encryption keys or access codes; the restore adds it by id, like entries. A phone that moves to another
address of the app (where the browser storage starts empty) exports from the old address and restores at the new one.

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
  `family` branch.
- Before merging into `main`, run `tools/private-check.sh`: it lists the files that mention a term listed in
  `docs/private/private-terms` on the local `family` branch. `pre-merge-commit` prints the same list during a
  merge commit into `main` (fast-forward merges skip it).
