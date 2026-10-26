/**
 * Virtual keyboard key persistence.
 *
 * Modified for Murphy's fork (new file, Apache-2.0 §4(b)).
 *
 * Kept in its own userData file (virtual-keys.json) instead of settings.json:
 * key text can be long, and settings are broadcast to the renderer on every
 * change. Writes are atomic (tmp + rename) like the rest of the stores.
 * Nothing is predefined — a missing file means "no keys yet".
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from './paths'
import { sanitizeVirtualKeys, type VirtualKey } from '../../shared/virtualKeys'

const FILE_VERSION = 1

let cache: VirtualKey[] | null = null

export function virtualKeysFile(): string {
  return join(PATHS.root(), 'virtual-keys.json')
}

export function loadVirtualKeys(): VirtualKey[] {
  if (cache) return cache
  try {
    const file = virtualKeysFile()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { keys?: unknown } | unknown[]
      cache = sanitizeVirtualKeys(Array.isArray(parsed) ? parsed : parsed?.keys)
    } else {
      cache = []
    }
  } catch (err) {
    console.error('[VirtualKeys] failed to read virtual-keys.json — starting empty:', err)
    cache = []
  }
  return cache
}

export function saveVirtualKeys(keys: unknown): VirtualKey[] {
  const next = sanitizeVirtualKeys(keys)
  cache = next
  try {
    const file = virtualKeysFile()
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, keys: next }, null, 2), 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    console.error('[VirtualKeys] failed to write virtual-keys.json (kept in memory):', err)
  }
  return next
}

export function findVirtualKey(id: string): VirtualKey | undefined {
  return loadVirtualKeys().find((k) => k.id === id)
}

/** Test hook. */
export function resetVirtualKeysCache(): void {
  cache = null
}
