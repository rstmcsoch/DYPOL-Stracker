import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { assetKey, clearLocalUserData, localDb } from './database'
import type { QueuedChange } from '../types'

const dbName = 'stracker-v1'
const ownerA = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const ownerB = 'b3f147d2-b7cf-53bd-a461-0d3cfed00002'
const sharedRecordId = '10000000-0000-4000-8000-000000000001'

async function deleteDatabase() {
  localDb.close()
  await localDb.delete()
}

afterEach(async () => { await deleteDatabase() })

describe('local database ownership indexes', () => {
  it('queries and clears only the selected account, including its own sync queue', async () => {
    await localDb.open()
    const chapter = (id: string, user_id: string) => ({
      id, user_id, subject: 'Physics' as const, name: `Chapter ${user_id}`, position: 0,
      status: 'Not Started' as const, priority: 'Medium' as const, importance: 'medium' as const, weightage: null,
      notes: '', formula_notes: '', completed_on: null, created_at: 'now', updated_at: 'now'
    })
    await localDb.chapters.bulkPut([chapter(`${sharedRecordId}-a`, ownerA), chapter(`${sharedRecordId}-b`, ownerB)])
    const queueItem = (user_id: string): Omit<QueuedChange, 'queueId'> => ({
      user_id, table: 'chapters', operation: 'upsert', id: sharedRecordId, queued_at: 'now', record: { id: sharedRecordId }
    })
    await localDb.sync_queue.add(queueItem(ownerA))
    await localDb.sync_queue.add(queueItem(ownerB))
    await localDb.assets.bulkPut([
      { id: assetKey(ownerA, sharedRecordId), mistake_id: sharedRecordId, user_id: ownerA, data_url: 'data:a', updated_at: 'now' },
      { id: assetKey(ownerB, sharedRecordId), mistake_id: sharedRecordId, user_id: ownerB, data_url: 'data:b', updated_at: 'now' }
    ])

    expect(await localDb.chapters.where('user_id').equals(ownerA).count()).toBe(1)
    expect(await localDb.sync_queue.where('[user_id+table+id]').equals([ownerA, 'chapters', sharedRecordId]).count()).toBe(1)
    await clearLocalUserData(ownerA)

    expect(await localDb.chapters.where('user_id').equals(ownerA).count()).toBe(0)
    expect(await localDb.chapters.where('user_id').equals(ownerB).count()).toBe(1)
    expect(await localDb.sync_queue.where('user_id').equals(ownerA).count()).toBe(0)
    expect(await localDb.sync_queue.where('user_id').equals(ownerB).count()).toBe(1)
    expect(await localDb.assets.where('user_id').equals(ownerA).count()).toBe(0)
    expect(await localDb.assets.where('user_id').equals(ownerB).count()).toBe(1)
  })

  it('upgrades old cached mistake assets to account-scoped keys without dropping data', async () => {
    await deleteDatabase()
    const old = new Dexie(dbName)
    old.version(1).stores({
      chapters: '&id, subject, status, updated_at',
      chapter_revisions: '&id, chapter_id, due_on, completed_at',
      tests: '&id, test_date, test_type, subject, chapter_id',
      test_subject_scores: '&id, test_id, subject',
      test_chapter_links: '&id, test_id, chapter_id',
      mistakes: '&id, chapter_id, test_id, mistake_type, retry_status',
      daily_tasks: '&id, task_date, is_completed, position',
      weekly_goals: '&id, week_start, goal_type',
      study_sessions: '&id, started_at, completion_state',
      app_settings: '&id, user_id', profiles: '&id, email',
      sync_queue: '++queueId, user_id, [table+id], table, id, queued_at',
      assets: '&id, user_id, updated_at'
    })
    await old.open()
    await old.table('assets').put({ id: sharedRecordId, user_id: ownerA, data_url: 'data:image/webp;base64,AA==', updated_at: 'now' })
    old.close()

    await localDb.open()
    const asset = await localDb.assets.get(assetKey(ownerA, sharedRecordId))
    expect(asset?.mistake_id).toBe(sharedRecordId)
    expect(asset?.data_url).toBe('data:image/webp;base64,AA==')
    expect(await localDb.chapters.where('user_id').equals(ownerA).count()).toBe(0)
  })
})
