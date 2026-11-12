# create-ghuri

Create a new [Ghuri](https://github.com/ghurijs/ghuri) project — Django for TypeScript on Cloudflare
Workers (Hono + Drizzle + D1 + R2), portable to Postgres / Node.

> Status: alpha (`0.1.0-alpha.0`). APIs may change.

```bash
npm create ghuri@latest
# or
pnpm create ghuri
bun create ghuri
yarn create ghuri
```

You are asked for:

1. **Project name** (letters, digits, `-`, `_`; the directory to create)
2. **Database** — Cloudflare D1 (default), Postgres (Hyperdrive on Workers / `DATABASE_URL` elsewhere), or
   SQLite (a Node.js project with better-sqlite3 and local file storage)
3. **Package manager** — npm, pnpm, bun or yarn (defaults to the one you ran `create` with)
4. **Add a GraphQL API?** — [`@ghuri/graphql`](https://github.com/ghurijs/graphql): `GraphQLConfig`,
   `src/schema.ts` and GraphiQL at `/graphql/` (default: no)
5. **Install dependencies?**
6. **Initialise a git repository?** (with an initial commit when git is configured)

Then it runs `ghuri startproject` from [`@ghuri/cli`](https://github.com/ghurijs/cli) (which generates a
random `SECRET_KEY` into `.dev.vars`) and prints the next steps:

```bash
cd my-ghuri-app
npx wrangler d1 create my-ghuri-app-db   # paste database_id into wrangler.jsonc (needed for deploys)
npx ghuri migrate
npx ghuri createsuperuser
npm run dev
```

## Non-interactive use

```bash
npm create ghuri@latest mysite -- --db d1 --pm npm --yes
```

| Option | |
|---|---|
| `[name]` | Project name / directory (default `my-ghuri-app` with `--yes`) |
| `--db <d1\|postgres\|sqlite>` | Database (default `d1`) |
| `--pm <npm\|pnpm\|bun\|yarn>` | Package manager (default: detected) |
| `--graphql` / `--no-graphql` | Add `@ghuri/graphql` (`startproject --graphql`; default: no) |
| `--install` / `--no-install` | Install dependencies (default: yes) |
| `--git` / `--no-git` | `git init` + initial commit (default: yes) |
| `-y, --yes` | Never prompt; use defaults for anything not given |
| `-h, --help` / `-v, --version` | Help / version |

Prompts are skipped automatically when stdin is not a terminal (CI).

## Programmatic API

```ts
import { createGhuri } from 'create-ghuri'

const exitCode = await createGhuri(['mysite', '--db', 'postgres', '--yes'], { cwd: '/tmp' })
```

## License

MIT
