// Disk persistence for the MCP server. The engine works against the in-memory
// Storage; each project is saved as a regular .satlapse file (the same format
// the web app imports), so anything an agent builds can be opened in the app.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exportProjectFile, importProjectFile, PROJECT_EXT } from '../core/project'
import { MemoryStorage } from '../core/storage'

export const DEFAULT_DATA_DIR = join(homedir(), '.satlapse', 'mcp')

export class DiskStore {
  readonly storage = new MemoryStorage()
  /** Files that could not be loaded, with the reason. */
  readonly loadErrors: string[] = []

  constructor(readonly dir: string | null) {}

  /** Loads every saved project. With `dir` null, nothing touches the disk. */
  async load(): Promise<this> {
    if (!this.dir) return this
    mkdirSync(this.dir, { recursive: true })
    for (const f of readdirSync(this.dir).filter((n) => n.endsWith(PROJECT_EXT))) {
      try {
        await importProjectFile(this.storage, new Uint8Array(readFileSync(join(this.dir, f))), { keepIds: true })
      } catch (e) {
        this.loadErrors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return this
  }

  async save(projectId: string): Promise<void> {
    if (!this.dir) return
    const bytes = await exportProjectFile(this.storage, projectId)
    const path = join(this.dir, `${projectId}${PROJECT_EXT}`)
    // Write then rename, so a crash mid-write never corrupts a saved project.
    writeFileSync(`${path}.tmp`, bytes)
    renameSync(`${path}.tmp`, path)
  }
}
