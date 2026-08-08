import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Never descend into dependency or build output trees. src/desktop contains
// its own node_modules/dist/release; walking them made discovery itself the
// slowest part of a test run and risked executing vendored test files.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.vite-temp', 'coverage'])

const testFiles = []

function discover(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) discover(path)
    else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) testFiles.push(relative(process.cwd(), path))
  }
}

// The core tier is the regression surface for the moving parts that actually
// break in the field: daemon lifecycle, RPC transport, provider parsing/pricing,
// and desktop presentation state. Pure formatting/presentation helpers only run
// on the full tier (`--all`), which CI uses.
const CORE_PATTERNS = [
  /^src\/client\//,
  /^src\/web\//,
  /^src\/providers\//,
  /^src\/desktop\/main\//,
  /^test\//,
  /^src\/rpc\//,
  /^src\/config/,
  /^src\/usage-semantics/,
  /^src\/provider-tracking/,
  /^src\/accounts-detection/,
]

const args = process.argv.slice(2)
const runAll = args.includes('--all')
const directories = args.filter(arg => arg !== '--all')
for (const directory of directories.length > 0 ? directories : ['src', 'test']) {
  discover(directory)
}
testFiles.sort((left, right) => left.localeCompare(right, 'en'))

const selected = runAll || directories.length > 0
  ? testFiles
  : testFiles.filter(file => CORE_PATTERNS.some(pattern => pattern.test(file.replaceAll('\\', '/'))))

if (selected.length === 0) {
  console.error('tokmon: no test files found')
  process.exit(1)
}

if (!runAll && directories.length === 0) {
  console.error(`tokmon: core tier — ${selected.length}/${testFiles.length} test files (pass --all for the full suite)`)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...selected], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
