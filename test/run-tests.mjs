import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const testFiles = []

function discover(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) discover(path)
    else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) testFiles.push(relative(process.cwd(), path))
  }
}

const directories = process.argv.slice(2)
for (const directory of directories.length > 0 ? directories : ['src', 'test']) {
  discover(directory)
}
testFiles.sort((left, right) => left.localeCompare(right, 'en'))

if (testFiles.length === 0) {
  console.error('tokmon: no test files found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...testFiles], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
