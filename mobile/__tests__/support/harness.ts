import { DataEngine, type EngineListener, type SyncState } from '../../src/lib/sync/engine'
import { MemoryLocalStore } from '../../src/lib/local-db/memory-store'
import type { AppData } from '../../src/shared/types'
import { FakeCloud } from './fake-cloud'

export const USER_ID = '11111111-2222-4333-8444-555555555555'

/** A device: its own local cache, sharing one cloud, with a controllable clock and network. */
export class Device {
  readonly store = new MemoryLocalStore()
  engine: DataEngine | null = null
  online = true
  syncState: SyncState = 'loading'
  syncError: string | null = null
  pending = 0
  undoAvailable = false
  latest: AppData | null = null
  clock: number
  private ids = 0
  readonly timers: { callback: () => void; handle: number }[] = []

  constructor(readonly cloud: FakeCloud, startTime = Date.parse('2026-10-09T03:30:00.000Z')) {
    this.clock = startTime
  }

  private listener: EngineListener = {
    onData: data => { this.latest = data },
    onSync: (state, error, pending) => { this.syncState = state; this.syncError = error; this.pending = pending },
    onUndo: available => { this.undoAvailable = available }
  }

  async boot(): Promise<DataEngine> {
    this.engine = new DataEngine({
      store: this.store,
      cloud: this.cloud,
      userId: USER_ID,
      profileDefaults: { displayName: 'Aarav', email: 'aarav@example.com' },
      listener: this.listener,
      isOnline: () => this.online && this.cloud.online,
      now: () => new Date(this.clock).toISOString(),
      newId: () => `photo-${++this.ids}`,
      setTimer: (callback, _ms) => {
        const handle = this.timers.length + 1
        this.timers.push({ callback, handle })
        return handle
      },
      clearTimer: handle => {
        const index = this.timers.findIndex(timer => timer.handle === handle)
        if (index >= 0) this.timers.splice(index, 1)
      }
    })
    await this.engine.start()
    return this.engine
  }

  get data(): AppData {
    if (!this.engine) throw new Error('device not booted')
    return this.engine.getData()
  }

  /** Simulates the platform layer: a restart re-reads the same on-device database. */
  async restart(): Promise<DataEngine> {
    this.engine?.dispose()
    return this.boot()
  }
}
