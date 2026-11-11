# Changelog

## 0.1.0-alpha.0

- `npm create ghuri@latest [name]`: prompts (project name, database D1 / Postgres / SQLite, package manager,
  install, git) with `@clack/prompts`, then runs `@ghuri/cli`'s `startProject()` and prints next steps.
- Non-interactive flags: `--db`, `--pm`, `--install` / `--no-install`, `--git` / `--no-git`, `--yes`.
- Programmatic `createGhuri(argv, options)`.
