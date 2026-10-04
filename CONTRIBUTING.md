# Contributing to Ore

Thanks for your interest! Issues and pull requests are equally welcome.

## Development setup

See [Build from source](README.md#build-from-source) in the README — in short:

```bash
git clone https://github.com/javedius/Ore.git
cd Ore/app
npm install
npm run tauri dev
```

Run the tests before submitting:

```bash
npm run build                  # frontend type-check + build
cd src-tauri && cargo test     # backend unit tests
```

CI runs exactly these checks on every pull request.

## Pull requests

- `main` is protected — open a PR even for small changes.
- Keep PRs small and focused: one feature or one fix per PR.
- Branch naming: `feat/…`, `fix/…`, `chore/…`.
- Commit messages: short imperative summary ("Add column filter row").
- CI must be green before merging.

## Code style

- **UI strings and code comments in English** — the project targets an international audience.
- Rust: run `cargo fmt` before committing.
- The frontend never talks to SQLite directly: all database access goes through
  IPC commands in `src-tauri/src/`. Table and column names are whitelist-checked
  on the Rust side — keep it that way.
- Design tokens live in `app/src/styles/tokens.css` — use the variables instead
  of hard-coded colors.

## Reporting issues

- Please **never attach private database files** — describe the relevant schema
  (table names, column types) instead.
- Include your OS, Ore version and steps to reproduce.
