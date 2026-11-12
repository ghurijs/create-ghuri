// create-ghuri — `npm create ghuri@latest [name]`: prompts, then runs @ghuri/cli's startproject.
import { spawn as nodeSpawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { parseArgs } from 'node:util'
import * as p from '@clack/prompts'
import {
  DATABASES,
  type DatabaseChoice,
  detectPackageManager,
  nextStepsFor,
  PACKAGE_MANAGERS,
  type PackageManager,
  pmCommands,
  startProject,
  validateProjectName,
} from '@ghuri/cli'
import pc from 'picocolors'

export type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; stdio?: 'inherit' | 'ignore' },
) => Promise<number>

export interface CreateOptions {
  cwd?: string
  /** Prompt for missing answers (default: stdin is a TTY and --yes was not given). */
  interactive?: boolean
  stdout?: (s: string) => void
  stderr?: (s: string) => void
  /** Replace child processes (package manager, git) — tests. */
  spawn?: SpawnFn
  /** Environment used to detect the package manager (default process.env). */
  env?: Record<string, string | undefined>
}

export interface CreateAnswers {
  name: string
  db: DatabaseChoice
  pm: PackageManager
  /** Add GraphQL (@ghuri/graphql). */
  graphql: boolean
  install: boolean
  git: boolean
}

const DEFAULT_NAME = 'my-ghuri-app'

export const HELP = `Usage: npm create ghuri@latest [name] -- [options]

Create a new Ghuri project (Django for TypeScript on Cloudflare Workers).

Options:
  --db <d1|postgres|sqlite>       Database (default: d1)
  --pm <npm|pnpm|bun|yarn>        Package manager (default: the one running create-ghuri)
  --graphql / --no-graphql        Add a GraphQL API with @ghuri/graphql (default: no)
  --install / --no-install        Install dependencies (default: yes)
  --git / --no-git                Initialise a git repository (default: yes)
  -y, --yes                       Accept defaults for everything not given; never prompt
  -h, --help                      Show this help
  -v, --version                   Show the version
`

const DB_LABELS: Record<DatabaseChoice, { label: string; hint: string }> = {
  d1: { label: 'Cloudflare D1', hint: 'SQLite at the edge — the default' },
  postgres: { label: 'Postgres', hint: 'Hyperdrive on Workers, DATABASE_URL elsewhere' },
  sqlite: { label: 'SQLite (Node.js)', hint: 'better-sqlite3 + local files, no Cloudflare' },
}

export class CreateError extends Error {}

function version(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

function nameError(name: string | undefined): string | undefined {
  try {
    validateProjectName(String(name ?? ''))
    return undefined
  } catch (err) {
    return (err as Error).message
  }
}

function cancelled(value: unknown): never | void {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    throw new CreateError('cancelled')
  }
}

export const defaultSpawn: SpawnFn = (command, args, opts) =>
  new Promise((resolve) => {
    const child = nodeSpawn(command, args, {
      cwd: opts.cwd,
      stdio: opts.stdio ?? 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', () => resolve(127))
    child.on('exit', (code) => resolve(code ?? 1))
  })

/** Parse argv into partial answers. */
export function parseCreateArgs(argv: string[]) {
  // `--no-install` / `--no-git` / `--no-graphql` (parseArgs' allowNegative needs Node 22.4+).
  const negated: { install?: boolean; git?: boolean; graphql?: boolean } = {}
  const rest = argv.filter((a) => {
    const m = /^--no-(install|git|graphql)$/.exec(a)
    if (m) negated[m[1] as 'install' | 'git' | 'graphql'] = false
    return !m
  })
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      db: { type: 'string' },
      pm: { type: 'string' },
      install: { type: 'boolean' },
      git: { type: 'boolean' },
      graphql: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (positionals.length > 1) throw new CreateError(`Unexpected arguments: ${positionals.slice(1).join(' ')}`)
  if (values.db !== undefined && !DATABASES.includes(values.db as DatabaseChoice)) {
    throw new CreateError(`--db must be one of ${DATABASES.join(', ')} (got '${values.db}').`)
  }
  if (values.pm !== undefined && !PACKAGE_MANAGERS.includes(values.pm as PackageManager)) {
    throw new CreateError(`--pm must be one of ${PACKAGE_MANAGERS.join(', ')} (got '${values.pm}').`)
  }
  return {
    name: positionals[0],
    db: values.db as DatabaseChoice | undefined,
    pm: values.pm as PackageManager | undefined,
    graphql: negated.graphql ?? values.graphql,
    install: negated.install ?? values.install,
    git: negated.git ?? values.git,
    yes: !!values.yes,
    help: !!values.help,
    version: !!values.version,
  }
}

/** Ask for whatever argv did not answer (interactive) or fill in defaults. */
export async function resolveAnswers(
  args: ReturnType<typeof parseCreateArgs>,
  opts: { interactive: boolean; env: Record<string, string | undefined> },
): Promise<CreateAnswers> {
  const detected = detectPackageManager(opts.env)
  if (!opts.interactive) {
    const name = args.name ?? DEFAULT_NAME
    const err = nameError(name)
    if (err) throw new CreateError(err)
    return {
      name,
      db: args.db ?? 'd1',
      pm: args.pm ?? detected,
      graphql: args.graphql ?? false,
      install: args.install ?? true,
      git: args.git ?? true,
    }
  }
  let name = args.name
  if (!name || nameError(name)) {
    const answer = await p.text({
      message: 'Project name',
      placeholder: DEFAULT_NAME,
      defaultValue: DEFAULT_NAME,
      initialValue: name,
      validate: (v) => (v ? nameError(v) : undefined),
    })
    cancelled(answer)
    name = String(answer || DEFAULT_NAME)
  }
  let db = args.db
  if (!db) {
    const answer = await p.select<DatabaseChoice>({
      message: 'Database',
      initialValue: 'd1',
      options: DATABASES.map((value) => ({ value, ...DB_LABELS[value] })),
    })
    cancelled(answer)
    db = answer as DatabaseChoice
  }
  let pm = args.pm
  if (!pm) {
    const answer = await p.select<PackageManager>({
      message: 'Package manager',
      initialValue: detected,
      options: PACKAGE_MANAGERS.map((value) => ({ value, label: value })),
    })
    cancelled(answer)
    pm = answer as PackageManager
  }
  let graphql = args.graphql
  if (graphql === undefined) {
    const answer = await p.confirm({ message: 'Add a GraphQL API (@ghuri/graphql)?', initialValue: false })
    cancelled(answer)
    graphql = answer as boolean
  }
  let install = args.install
  if (install === undefined) {
    const answer = await p.confirm({ message: `Install dependencies with ${pm}?`, initialValue: true })
    cancelled(answer)
    install = answer as boolean
  }
  let git = args.git
  if (git === undefined) {
    const answer = await p.confirm({ message: 'Initialise a git repository?', initialValue: true })
    cancelled(answer)
    git = answer as boolean
  }
  return { name, db, pm, graphql, install, git }
}

/**
 * Run create-ghuri. Returns the exit code.
 *
 * ```ts
 * await createGhuri(['mysite', '--db', 'd1', '--pm', 'npm', '--yes'])
 * ```
 */
export async function createGhuri(argv: string[], opts: CreateOptions = {}): Promise<number> {
  const out = opts.stdout ?? ((s: string) => process.stdout.write(s))
  const err = opts.stderr ?? ((s: string) => process.stderr.write(s))
  const cwd = opts.cwd ?? process.cwd()
  const spawn = opts.spawn ?? defaultSpawn
  const env = opts.env ?? process.env
  let args: ReturnType<typeof parseCreateArgs>
  try {
    args = parseCreateArgs(argv)
  } catch (e) {
    err(`${pc.red((e as Error).message)}\n\n${HELP}`)
    return 2
  }
  if (args.help) {
    out(HELP)
    return 0
  }
  if (args.version) {
    out(`${version()}\n`)
    return 0
  }
  const interactive = opts.interactive ?? (!args.yes && !!process.stdin.isTTY && !!process.stdout.isTTY)
  const say = (msg: string) => (interactive ? p.log.message(msg) : out(`${msg}\n`))

  try {
    if (interactive) p.intro(pc.bgCyan(pc.black(' create-ghuri ')))
    const answers = await resolveAnswers(args, { interactive, env })
    const result = startProject({
      name: answers.name,
      cwd,
      db: answers.db,
      pm: answers.pm,
      graphql: answers.graphql,
    })
    const extras = answers.graphql ? ' + GraphQL' : ''
    say(
      `${pc.green('✔')} Created ${pc.bold(answers.name)} (${DB_LABELS[answers.db].label}${extras}) in ${result.directory}`,
    )

    let installed = false
    if (answers.install) {
      const cmd = pmCommands(answers.pm).install.split(' ')
      say(`Installing dependencies with ${answers.pm}…`)
      const code = await spawn(cmd[0], cmd.slice(1), { cwd: result.directory })
      installed = code === 0
      if (!installed) say(pc.yellow(`'${cmd.join(' ')}' failed (exit ${code}) — run it yourself.`))
    }

    if (answers.git) {
      const quiet = { cwd: result.directory, stdio: 'ignore' as const }
      if ((await spawn('git', ['init', '-q'], quiet)) === 0) {
        await spawn('git', ['add', '-A'], quiet)
        const committed = await spawn(
          'git',
          ['commit', '-q', '-m', 'Initial commit from create-ghuri'],
          quiet,
        )
        say(
          committed === 0
            ? `${pc.green('✔')} Initialised a git repository`
            : 'Initialised a git repository (no commit made)',
        )
      } else say(pc.yellow('git init failed — is git installed?'))
    }

    const rel = relative(cwd, result.directory) || '.'
    const steps = nextStepsFor({
      dirLabel: rel.startsWith('..') ? result.directory : rel,
      db: answers.db,
      pm: answers.pm,
      installed,
      pkgName: answers.name.toLowerCase().replace(/_/g, '-'),
    })
    if (interactive) {
      p.note(steps.join('\n'), 'Next steps')
      p.outro(`Happy hacking! Docs: ${pc.underline('https://github.com/ghurijs/ghuri')}`)
    } else {
      out(`\nNext steps:\n${steps.map((s) => `  ${s}`).join('\n')}\n`)
    }
    return 0
  } catch (e) {
    if (e instanceof CreateError && e.message === 'cancelled') return 130
    err(`${pc.red((e as Error).message)}\n`)
    return 1
  }
}
