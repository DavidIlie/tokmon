import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { detectPi, piSessionsDir, piTable } from './usage'

test('pi directory overrides follow upstream precedence and discover sessions', async (t) => {
  const originalEnv = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"].map(key => [key, process.env[key]] as const)
  t.after(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const root = await mkdtemp(join(tmpdir(), 'tokmon-pi-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent')
  process.env.PI_CODING_AGENT_SESSION_DIR = ''
  assert.equal(piSessionsDir(), join(root, 'agent/sessions'))
  const sessions = join(root, 'custom-sessions')
  process.env.PI_CODING_AGENT_SESSION_DIR = pathToFileURL(sessions).href
  assert.equal(piSessionsDir(), sessions)
  assert.equal(piSessionsDir('/account'), join('/account', '.pi/agent/sessions'))
  await mkdir(sessions)
  await writeFile(join(sessions, 'session.jsonl'), JSON.stringify({
    type: 'message', timestamp: new Date().toISOString(),
    message: { role: 'assistant', model: 'test', usage: { input: 10, output: 20, cost: { total: 0.75 } } },
  }))
  assert.equal(await detectPi(), true)
  assert.equal((await piTable('UTC')).daily[0].cost, 0.75)
  assert.equal(await detectPi(join(root, 'other-account')), false)
  process.env.PI_CODING_AGENT_SESSION_DIR = '~/pi-sessions'
  assert.equal(piSessionsDir(), join(homedir(), 'pi-sessions'))
  process.env.PI_CODING_AGENT_SESSION_DIR = ''
  process.env.PI_CODING_AGENT_DIR = '~/pi-agent'
  assert.equal(piSessionsDir(), join(homedir(), 'pi-agent/sessions'))
  process.env.PI_CODING_AGENT_DIR = ''
  assert.equal(piSessionsDir(), join(homedir(), '.pi/agent/sessions'))
})
