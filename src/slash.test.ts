// Your commands and skills, as read from Claude's folders (made-up ones here).
import { afterEach, assert, test } from 'orca/testing'
import { frontMatter, readFolderCommands, readUserCommands, setSlashDisk } from './slash.ts'

const host = { platform: 'linux', env: { HOME: '/home/me' } }

/** Files by path; a folder is whatever some file's path goes through. */
function fakeDisk(files: Record<string, string>): string[] {
  const asked: string[] = []
  setSlashDisk({
    list: async (dir) => {
      asked.push(dir)
      const names = new Set<string>()
      for (const path of Object.keys(files)) if (path.startsWith(`${dir}/`)) names.add(path.slice(dir.length + 1).split('/')[0]!)
      return names.size ? [...names] : null
    },
    read: async (path) => {
      asked.push(path)
      return files[path] ?? null
    }
  })
  return asked
}

afterEach(() => setSlashDisk(null))

test('the fields at the top of a file: plain, quoted, and over several lines', () => {
  const { fields, body } = frontMatter(
    ['---', 'name: web-browse', 'description: >', '  웹사이트를 열어서', '  조작한다.', 'argument-hint: "[url]"', 'allowed-tools:', '  - Bash', '---', '', '# Title', 'text'].join('\r\n')
  )
  assert.equal(fields['name'], 'web-browse')
  assert.equal(fields['description'], '웹사이트를 열어서 조작한다.')
  assert.equal(fields['argument-hint'], '[url]')
  assert.equal(body.trim(), '# Title\ntext')
  // No fields at all: the whole file is its text.
  assert.deepEqual(frontMatter('# Just a prompt\nDo it.'), { fields: {}, body: '# Just a prompt\nDo it.' })
})

test('yours in every chat: commands, skills, and the plugins turned on for you', async () => {
  fakeDisk({
    '/home/me/.claude/commands/sd.md': '# 전략 개발 자동화\n\n본문',
    '/home/me/.claude/commands/git/sync.md': '---\ndescription: Sync the branch\nargument-hint: [branch]\n---\nbody',
    '/home/me/.claude/commands/notes.txt': 'not a command',
    '/home/me/.claude/skills/web-browse/SKILL.md': '---\nname: web-browse\ndescription: Pick a browser tool\n---\n',
    '/home/me/.claude/skills/quiet/SKILL.md': '---\ndescription: Only Claude calls this\nuser-invocable: false\n---\n',
    '/home/me/.claude/skills/readme.md': 'no skill: a file, not a folder',
    '/home/me/.claude/skills/synced/account-1/docx/SKILL.md': '---\nname: docx\ndescription: Word documents\n---\n',
    '/home/me/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'vercel@official': true, 'off@official': false } }),
    '/home/me/.claude/plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: {
        'vercel@official': [{ scope: 'user', installPath: '/p/vercel' }],
        'off@official': [{ scope: 'user', installPath: '/p/off' }],
        'local@official': [{ scope: 'project', projectPath: '/work/app', installPath: '/p/local' }]
      }
    }),
    '/p/vercel/.claude-plugin/plugin.json': JSON.stringify({ name: 'vercel', commands: ['./commands/deploy.md'] }),
    '/p/vercel/commands/deploy.md': '---\ndescription: Deploy the project\n---\n',
    '/p/vercel/commands/_conventions.md': 'not named by the plugin',
    '/p/vercel/skills/nextjs/SKILL.md': '---\ndescription: Next.js guidance\n---\n',
    '/p/off/commands/never.md': 'turned off',
    '/p/local/commands/here.md': 'for one project'
  })
  assert.deepEqual(await readUserCommands(host), [
    { name: 'sd', about: '전략 개발 자동화', from: 'user' },
    { name: 'sync', about: 'Sync the branch', from: 'user', hint: '[branch]' },
    { name: 'web-browse', about: 'Pick a browser tool', from: 'user' },
    { name: 'anthropic-skills:docx', about: 'Word documents', from: 'user' },
    { name: 'vercel:deploy', about: 'Deploy the project', from: 'plugin' },
    { name: 'vercel:nextjs', about: 'Next.js guidance', from: 'plugin' }
  ])
})

test("a chat's own: its folder's .claude and those above it, up to the repository's top", async () => {
  const asked = fakeDisk({
    '/work/app/.git/HEAD': 'ref: refs/heads/main',
    '/work/app/.claude/commands/ship.md': 'Ship it',
    '/work/app/pkg/.claude/skills/lint/SKILL.md': '---\ndescription: Lint the package\n---\n',
    '/work/.claude/commands/outside.md': 'above the repository: not this chat\'s',
    '/work/app/.claude/settings.local.json': JSON.stringify({ enabledPlugins: { 'local@official': true } }),
    '/home/me/.claude/plugins/installed_plugins.json': JSON.stringify({
      plugins: { 'local@official': [{ scope: 'project', projectPath: '/work/app', installPath: '/p/local' }], 'mine@official': [{ scope: 'user', installPath: '/p/mine' }] }
    }),
    '/p/local/commands/here.md': 'for one project',
    '/p/mine/commands/everywhere.md': 'read with yours, not here'
  })
  assert.deepEqual(await readFolderCommands(host, '/work/app/pkg'), [
    { name: 'lint', about: 'Lint the package', from: 'project' },
    { name: 'ship', about: 'Ship it', from: 'project' },
    { name: 'local:here', about: 'for one project', from: 'plugin' }
  ])
  assert.ok(!asked.some((path) => path.startsWith('/work/.claude')))
  // A chat in your home folder: its `.claude` is the one read as yours, not once more as the folder's.
  fakeDisk({ '/home/me/.claude/commands/sd.md': 'yours', '/home/me/.git/HEAD': 'ref' })
  assert.deepEqual(await readFolderCommands(host, '/home/me'), [])
})
