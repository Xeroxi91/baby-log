# Branches and remotes

Two remotes: `origin` is the public repository; `private` is a private copy used for work in progress.

## Branches

| Branch | What it holds | Pushed to |
|---|---|---|
| `main` | releases | `origin` and `private` (`git push-main`) |
| `dev` | work that can become public | `private` |
| a private build branch | `dev` plus extensions that stay private, deployed separately | `private` |
| `core/*` | a piece of work for `dev`, started from `dev` | `private` |
| `mod/*` | a piece of work on private extensions, started from the private build branch | `private` |

Flow:

```
core/* ──► dev ──► main
            │
            └──► private build ◄── mod/*
```

- `dev` is merged into the private build branch regularly, so that extensions always run on the current core.
- The private build branch is **never** merged into `dev` or `main`. A change made there that belongs to the core
  is redone on a `core/*` branch.
- The private build branch is the production branch of its own deployment (static files, no build step).

## Backups between copies of the app

The JSON backup also carries what a feature keeps only on the phone (`localKeys` in the features list), never
encryption keys or access codes; the restore adds it by id, like entries. A phone that moves to another
address of the app (where the browser storage starts empty) exports from the old address and restores at the new one.

## Extensions

`index.html` has `<meta name="extensions" content="">`. On `main` and `dev` it is empty and nothing is
requested. A private build sets it to `modules/extensions.js`, which registers more features (through
`addFeatures`, the same fields as the built-in features) and their strings. It is one line, so merging
`dev` into the private build does not conflict as long as `dev` leaves that line alone.
Tests run on every branch: `cd tools && npm test`.

## Guards

Run `sh tools/setup-hooks.sh` once per clone. It installs the versioned hooks (`tools/hooks/`) and sets the
push targets (`remote.pushDefault = private`, `branch.main.pushRemote = origin`, alias `git push-main`).

- `pre-push` refuses any branch other than `main` to `origin` (tags only of commits already in `main`), and refuses a `main` or tag that contains
  `modules/extensions.js`, whose `index.html` names an extensions file, or that contains a path listed in the local
  git config `privacy.paths` (space-separated; set in each clone that keeps private work, never versioned here).
- Before merging into `main`, run `tools/private-check.sh`: it lists the files that mention a term of the local git
  config `privacy.terms`. `pre-merge-commit` prints the same list during a merge commit into `main` (fast-forward
  merges skip it).