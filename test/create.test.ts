import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { type CreateOptions, createGhuri, parseCreateArgs, resolveAnswers } from '../src/create'

const TMP = resolve(import.meta.dirname, '.tmp')
const dirs: string[] = []
let n = 0
function tmpDir() {
  const d = join(TMP, `c-${process.pid}-${Date.now()}-${n++}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

async function create(argv: string[], opts: CreateOptions = {}) {
  let out = ''
  let err = ''
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = []
  const code = await createGhuri(argv, {
    interactive: false,
    env: {},
    stdout: (s) => {
      out += s
    },
    stderr: (s) => {
      err += s
    },
    spawn: async (cmd, args, o) => {
      calls.push({ cmd, args, cwd: o.cwd })
      return 0
    },
    ...opts,
  })
  return { code, out, err, calls }
}

describe('parseCreateArgs', () => {
  it('parses name, flags and negations', () => {
    expect(
      parseCreateArgs(['site', '--db', 'postgres', '--pm', 'pnpm', '--no-install', '--no-git', '-y']),
    ).toEqual({
      name: 'site',
      db: 'postgres',
      pm: 'pnpm',
      graphql: undefined,
      install: false,
      git: false,
      yes: true,
      help: false,
      version: false,
    })
    expect(parseCreateArgs([]).install).toBeUndefined()
    expect(parseCreateArgs(['--graphql']).graphql).toBe(true)
    expect(parseCreateArgs(['--no-graphql']).graphql).toBe(false)
  })

  it('validates choices', () => {
    expect(() => parseCreateArgs(['--db', 'mongo'])).toThrow(/--db must be one of d1, postgres, sqlite/)
    expect(() => parseCreateArgs(['--pm', 'pip'])).toThrow(/--pm must be one of/)
    expect(() => parseCreateArgs(['--bogus'])).toThrow()
  })
})

describe('resolveAnswers (non-interactive)', () => {
  it('fills defaults and detects the package manager', async () => {
    const a = await resolveAnswers(parseCreateArgs(['--yes']), {
      interactive: false,
      env: { npm_config_user_agent: 'pnpm/9.0.0 npm/? node/v24' },
    })
    expect(a).toEqual({
      name: 'my-ghuri-app',
      db: 'd1',
      pm: 'pnpm',
      graphql: false,
      install: true,
      git: true,
    })
  })

  it('rejects invalid names', async () => {
    await expect(
      resolveAnswers(parseCreateArgs(['9lives']), { interactive: false, env: {} }),
    ).rejects.toThrow(/not a valid project name/)
  })
})

describe('createGhuri', () => {
  it('creates a project non-interactively, installs and initialises git', async () => {
    const cwd = tmpDir()
    const { code, out, calls } = await create(['shop', '--db', 'd1', '--pm', 'npm', '--yes'], { cwd })
    expect(code).toBe(0)
    const dir = join(cwd, 'shop')
    expect(existsSync(join(dir, 'wrangler.jsonc'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name).toBe('shop')
    expect(readFileSync(join(dir, '.dev.vars'), 'utf8')).toMatch(/^SECRET_KEY=[\w-]{64}$/m)
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['npm', 'install'],
      ['git', 'init', '-q'],
      ['git', 'add', '-A'],
      ['git', 'commit', '-q', '-m', 'Initial commit from create-ghuri'],
    ])
    for (const c of calls) expect(c.cwd).toBe(dir)
    expect(out).toContain('Created shop (Cloudflare D1)')
    expect(out).toContain('Next steps:\n  cd shop\n  npx wrangler d1 create shop-db')
    expect(out).toContain('  npx ghuri migrate\n  npx ghuri createsuperuser\n  npm run dev\n')
    expect(out).not.toContain('  npm install\n')
  })

  it('honours --no-install / --no-git and other databases', async () => {
    const cwd = tmpDir()
    const { code, out, calls } = await create(
      ['lite_app', '--db', 'sqlite', '--pm', 'bun', '--no-install', '--no-git'],
      {
        cwd,
      },
    )
    expect(code).toBe(0)
    expect(calls).toEqual([])
    expect(existsSync(join(cwd, 'lite_app', 'wrangler.jsonc'))).toBe(false)
    expect(out).toContain('bun install')
    expect(out).toContain('bunx ghuri migrate')
    expect(out).not.toContain('wrangler d1 create')
  })

  it('--graphql adds @ghuri/graphql to the project', async () => {
    const cwd = tmpDir()
    const { code, out } = await create(['api', '--graphql', '--yes', '--no-install', '--no-git'], { cwd })
    expect(code).toBe(0)
    expect(out).toContain('Created api (Cloudflare D1 + GraphQL)')
    const pkg = JSON.parse(readFileSync(join(cwd, 'api', 'package.json'), 'utf8'))
    expect(pkg.dependencies['@ghuri/graphql']).toBeTruthy()
    expect(existsSync(join(cwd, 'api', 'src', 'schema.ts'))).toBe(true)
  })

  it('reports a failed install but still finishes', async () => {
    const cwd = tmpDir()
    const { code, out } = await create(['site', '--yes', '--no-git'], { cwd, spawn: async () => 1 })
    expect(code).toBe(0)
    expect(out).toContain("'npm install' failed")
    expect(out).toContain('  npm install\n')
  })

  it('fails on an existing non-empty directory', async () => {
    const cwd = tmpDir()
    await create(['site', '--yes', '--no-install', '--no-git'], { cwd })
    const again = await create(['site', '--yes', '--no-install', '--no-git'], { cwd })
    expect(again.code).toBe(1)
    expect(again.err).toContain('already exists')
  })

  it('prints help and usage errors', async () => {
    const help = await create(['--help'])
    expect(help.code).toBe(0)
    expect(help.out).toContain('Usage: npm create ghuri@latest')
    const bad = await create(['--db', 'nope'])
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('--db must be one of')
    expect((await create(['--version'])).out).toMatch(/^0\.1\.0/)
  })
})
