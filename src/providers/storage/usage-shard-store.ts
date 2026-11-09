import { chmod, mkdir, open, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

/**
 * A small, file-addressed cache for parsed usage logs.  It deliberately has no
 * index: an index would become another large file which every writer has to
 * rewrite.  The source path deterministically selects one atomically-written
 * shard instead.
 */
export interface UsageCacheFingerprint {
  /** Changes when the on-disk shard shape changes. */
  format: string
  /** Changes when the log parser's interpretation changes. */
  parser: string
  /** Changes when the cost/pricing rules used by the parser change. */
  pricing: string
}

export interface UsageCacheSource {
  path: string
  mtimeMs: number
  size: number
}

export interface UsageShardStoreOptions<T> {
  dir: string
  fingerprint: UsageCacheFingerprint
  maxMemoryBytes?: number
  maxMemoryShards?: number
  staleAfterMs?: number
  now?: () => number
  encode: (entries: T[]) => unknown
  decode: (value: unknown) => T[] | null
}

type Cached<T> = {
  source: UsageCacheSource
  entries: T[]
  bytes: number
  persisted: boolean
  /** When this revision was parsed or read, and what producing it cost. */
  parsedAt: number
  parseMs: number
  /** Last successful shard write for this path (-Infinity: never), carried across revisions. */
  persistedAt: number
  /** Bytes just before `source.size`, proving a later, larger file only appended. */
  tailProbe?: string | null
}

export interface UsageLoadResult<T> {
  entries: T[]
  /**
   * False while a newer revision is deferred or still unwritten. Callers that
   * memoize across refreshes must not pin an unsettled result.
   */
  settled: boolean
}

type DiskShard = {
  format: string
  fingerprint: UsageCacheFingerprint
  source: UsageCacheSource
  entries: unknown
}

const DEFAULT_MAX_MEMORY_BYTES = 48 * 1024 * 1024
const DEFAULT_MAX_MEMORY_SHARDS = 192
const DEFAULT_STALE_AFTER_MS = 230 * 86_400_000
const PRUNE_INTERVAL_MS = 60 * 60_000
// A log that is being appended changes on every poll. Reparsing it may spend at
// most 1/REPARSE_DUTY of wall time, so a slow parse backs itself off instead of
// pinning a core; cheap parses (under the floor) are never deferred.
const REPARSE_DUTY = 20
const REPARSE_DEFER_FLOOR_MS = 25
const REPARSE_DEFER_MAX_MS = 30_000
// The shard for a hot log is rewritten at most this often; the parsed rows stay
// in memory meanwhile, and the next quiet poll writes the final revision.
const PERSIST_MIN_INTERVAL_MS = 15_000
const TAIL_PROBE_BYTES = 64

/** The bytes ending at `end`, or null unless they close a complete line. */
async function tailProbe(path: string, end: number): Promise<string | null> {
  if (end <= 0) return null
  const length = Math.min(TAIL_PROBE_BYTES, end)
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, end - length)
      if (bytesRead !== length || buffer[length - 1] !== 0x0a) return null
      return buffer.toString('base64')
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sameSource(a: UsageCacheSource, b: UsageCacheSource): boolean {
  return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size
}

function isSource(value: unknown): value is UsageCacheSource {
  const x = value as Partial<UsageCacheSource> | null
  return !!x && typeof x.path === 'string'
    && typeof x.mtimeMs === 'number' && Number.isFinite(x.mtimeMs)
    && typeof x.size === 'number' && Number.isFinite(x.size)
}

function sameFingerprint(a: UsageCacheFingerprint, b: UsageCacheFingerprint): boolean {
  return a.format === b.format && a.parser === b.parser && a.pricing === b.pricing
}

/**
 * Incremental persistence with an LRU memory front cache.  A store instance is
 * scoped to an explicit fingerprint; a different parser/pricing version can
 * never accidentally consume its shards.
 */
export class UsageShardStore<T> {
  private readonly root: string
  private readonly shardDir: string
  private readonly maxMemoryBytes: number
  private readonly maxMemoryShards: number
  private readonly staleAfterMs: number
  private readonly now: () => number
  private readonly memory = new Map<string, Cached<T>>()
  private readonly inFlight = new Map<string, Promise<Cached<T>>>()
  private readonly latestRequest = new Map<string, string>()
  private readonly writes = new Set<Promise<void>>()
  private memoryBytes = 0
  private initialized: Promise<void> | null = null
  private lastPrune = 0

  constructor(private readonly options: UsageShardStoreOptions<T>) {
    this.root = join(options.dir, 'usage-shards')
    // Fingerprints are data, not filenames: hash them before using them in a path.
    this.shardDir = join(this.root, `v1-${digest(JSON.stringify(options.fingerprint)).slice(0, 24)}`)
    this.maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES
    this.maxMemoryShards = options.maxMemoryShards ?? DEFAULT_MAX_MEMORY_SHARDS
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
    this.now = options.now ?? Date.now
  }

  /** Loads an unchanged shard or parses it exactly once among concurrent callers. */
  async load(
    source: UsageCacheSource,
    parse: () => Promise<T[]>,
    parseTail?: (fromByte: number) => Promise<T[]>,
  ): Promise<T[]> {
    return (await this.loadTracked(source, parse, parseTail)).entries
  }

  /**
   * `parseTail`, when the log format allows it, parses only the bytes appended
   * since the cached revision. `parse` must then read exactly `source.size`
   * bytes so the two never overlap.
   */
  async loadTracked(
    source: UsageCacheSource,
    parse: () => Promise<T[]>,
    parseTail?: (fromByte: number) => Promise<T[]>,
  ): Promise<UsageLoadResult<T>> {
    const key = this.key(source.path)
    const cached = this.memory.get(key)
    if (cached && sameSource(cached.source, source)) {
      this.touch(key, cached)
      if (!cached.persisted && this.now() - cached.persistedAt >= PERSIST_MIN_INTERVAL_MS) {
        await this.persist(key, cached)
      }
      return { entries: cached.entries, settled: cached.persisted }
    }
    if (cached && cached.parseMs >= REPARSE_DEFER_FLOOR_MS
      && this.now() - cached.parsedAt < Math.min(REPARSE_DEFER_MAX_MS, cached.parseMs * REPARSE_DUTY)) {
      this.touch(key, cached)
      return { entries: cached.entries, settled: false }
    }

    // A path can be appended while a dashboard refresh is parsing it.  Only
    // coalesce work for the exact source revision; a caller that observed newer
    // metadata gets older entries only through the bounded deferral above.
    const flightKey = `${key}\0${source.mtimeMs}\0${source.size}`
    this.latestRequest.set(key, flightKey)
    let pending = this.inFlight.get(flightKey)
    if (!pending) {
      pending = this.loadOrParse(key, flightKey, source, parse, parseTail)
      this.inFlight.set(flightKey, pending)
      void pending.finally(() => {
        this.inFlight.delete(flightKey)
        if (this.latestRequest.get(key) === flightKey) this.latestRequest.delete(key)
      }).catch(() => {})
    }
    const loaded = await pending
    return { entries: loaded.entries, settled: loaded.persisted }
  }

  /** Waits for incremental writes; retained for the existing daemon shutdown hook. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.writes])
  }

  /** Deletes only completed shard files.  Temp files are intentionally never scavenged. */
  async prune(force = false): Promise<void> {
    const now = this.now()
    if (!force && now - this.lastPrune < PRUNE_INTERVAL_MS) return
    this.lastPrune = now
    await this.ensureDirectory()
    let namespaces: string[]
    try {
      namespaces = (await readdir(this.root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && /^v1-[a-f0-9]{24}$/.test(entry.name))
        .map(entry => entry.name)
    } catch { return }
    const completed: string[] = []
    await mapLimit(namespaces, 8, async namespace => {
      const dir = join(this.root, namespace)
      try {
        const names = await readdir(dir)
        for (const name of names) {
          if (/^[a-f0-9]{64}\.json$/.test(name)) completed.push(join(dir, name))
        }
      } catch {}
    })
    await mapLimit(completed, 16, async file => {
      try {
        const raw = JSON.parse(await readFile(file, 'utf8')) as DiskShard
        if (!isSource(raw?.source) || now - raw.source.mtimeMs >= this.staleAfterMs) {
          await unlink(file).catch(() => {})
        }
      } catch {
        // Broken completed shards cannot be read on a later invocation either.
        await unlink(file).catch(() => {})
      }
    })
    // Empty obsolete namespaces are removed, but a live writer's temp file
    // makes rmdir fail and is never touched by this process.
    await Promise.all(namespaces.map(async namespace => {
      const dir = join(this.root, namespace)
      if (dir !== this.shardDir) await rmdir(dir).catch(() => {})
    }))
  }

  memoryStats(): { shards: number; bytes: number; inFlight: number } {
    return { shards: this.memory.size, bytes: this.memoryBytes, inFlight: this.inFlight.size }
  }

  private async loadOrParse(
    key: string,
    requestKey: string,
    source: UsageCacheSource,
    parse: () => Promise<T[]>,
    parseTail?: (fromByte: number) => Promise<T[]>,
  ): Promise<Cached<T>> {
    await this.ensureDirectory()
    const prior = this.memory.get(key)
    // With an older revision in memory the shard on disk is that revision or an
    // earlier one, so reading it back could only miss.
    const onDisk = prior ? null : await this.read(key, source)
    if (onDisk) {
      return this.latestRequest.get(key) === requestKey ? this.remember(key, onDisk) : onDisk
    }

    const started = this.now()
    let entries: T[] | null = null
    let bytes: number | null = null
    if (parseTail && prior?.tailProbe
      && source.size > prior.source.size && source.mtimeMs >= prior.source.mtimeMs
      && await tailProbe(source.path, prior.source.size) === prior.tailProbe) {
      const appended = await parseTail(prior.source.size)
      entries = prior.entries.concat(appended)
      // Sizing only the new rows keeps an append from re-serialising the file's whole history.
      bytes = prior.bytes + this.estimate(appended)
    }
    entries ??= await parse()
    const finished = this.now()
    const cached: Cached<T> = {
      source: { ...source },
      entries,
      bytes: bytes ?? this.estimate(entries),
      persisted: false,
      parsedAt: finished,
      parseMs: finished - started,
      persistedAt: prior?.persistedAt ?? Number.NEGATIVE_INFINITY,
      tailProbe: parseTail ? await tailProbe(source.path, source.size) : null,
    }
    // A slower parse of an older file revision must not overwrite the shard or
    // memory entry produced by a newer observation of the same path.
    if (this.latestRequest.get(key) !== requestKey) return cached
    this.remember(key, cached)
    if (finished - cached.persistedAt >= PERSIST_MIN_INTERVAL_MS) await this.persist(key, cached)
    void this.prune().catch(() => {})
    return cached
  }

  private async read(key: string, source: UsageCacheSource): Promise<Cached<T> | null> {
    try {
      const text = await readFile(this.file(key), 'utf8')
      const raw = JSON.parse(text) as DiskShard
      if (!raw || raw.format !== 'tokmon.usage-shard/v1'
        || !sameFingerprint(raw.fingerprint, this.options.fingerprint)
        || !sameSource(raw.source, source)) return null
      const entries = this.options.decode(raw.entries)
      if (!entries) return null
      const now = this.now()
      return {
        // The shard's own length is the size estimate; re-encoding the rows
        // just to measure them doubled the cost of every cold load.
        source: { ...source }, entries, bytes: text.length,
        persisted: true, parsedAt: now, parseMs: 0, persistedAt: now,
      }
    } catch {
      return null
    }
  }

  private async persist(key: string, cached: Cached<T>): Promise<void> {
    const write = this.write(key, cached).then(() => {
      cached.persisted = true
      cached.persistedAt = this.now()
    }).catch(() => {
      // Keep serving the parsed entries.  A later cache hit retries persistence.
      cached.persisted = false
    })
    this.writes.add(write)
    try { await write } finally { this.writes.delete(write) }
  }

  private async write(key: string, cached: Cached<T>): Promise<void> {
    await this.ensureDirectory()
    const file = this.file(key)
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
    const value: DiskShard = {
      format: 'tokmon.usage-shard/v1',
      fingerprint: this.options.fingerprint,
      source: cached.source,
      entries: this.options.encode(cached.entries),
    }
    try {
      await writeFile(tmp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, file)
    } catch (error) {
      // This process created this exact name; never touch another writer's temp.
      await unlink(tmp).catch(() => {})
      throw error
    }
  }

  private remember(key: string, cached: Cached<T>): Cached<T> {
    const old = this.memory.get(key)
    if (old) this.memoryBytes -= old.bytes
    this.memory.delete(key)
    this.memory.set(key, cached)
    this.memoryBytes += cached.bytes
    this.evict()
    return cached
  }

  private touch(key: string, cached: Cached<T>): void {
    this.memory.delete(key)
    this.memory.set(key, cached)
  }

  private evict(): void {
    while (this.memory.size > this.maxMemoryShards || this.memoryBytes > this.maxMemoryBytes) {
      const oldest = this.memory.entries().next().value as [string, Cached<T>] | undefined
      if (!oldest) break
      this.memory.delete(oldest[0])
      this.memoryBytes -= oldest[1].bytes
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        // chmod also repairs a directory created by an older insecure release.
        await mkdir(this.options.dir, { recursive: true, mode: 0o700 })
        await chmod(this.options.dir, 0o700)
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        await chmod(this.root, 0o700)
        await mkdir(this.shardDir, { recursive: true, mode: 0o700 })
        await chmod(this.shardDir, 0o700)
      })()
    }
    await this.initialized
  }

  private key(path: string): string { return digest(path) }
  private file(key: string): string { return join(this.shardDir, `${key}.json`) }
  private estimate(entries: T[]): number {
    // Serialized length tracks the dominant retention cost without retaining a
    // second copy of every payload just for accounting.
    try { return Buffer.byteLength(JSON.stringify(this.options.encode(entries))) } catch { return 1024 }
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
