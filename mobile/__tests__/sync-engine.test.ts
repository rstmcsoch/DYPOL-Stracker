import { emptyChapterStage, seedChapters } from '../src/shared/lib/defaults'
import { FakeCloud } from './support/fake-cloud'
import { Device, USER_ID } from './support/harness'

const base64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')

describe('offline-first sync engine', () => {
  it('seeds the syllabus once and never duplicates chapters across restarts', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()

    const seeded = seedChapters(USER_ID)
    expect(device.data.chapters).toHaveLength(seeded.length)
    expect(cloud.rows('chapters')).toHaveLength(seeded.length)

    // A restart, or a second device signing in, re-reads the cloud. Stable IDs make any repeated seed
    // an idempotent upsert, so the count must not grow.
    await device.restart()
    await device.restart()
    expect(cloud.rows('chapters')).toHaveLength(seeded.length)
    expect(device.data.chapters).toHaveLength(seeded.length)
    expect(new Set(device.data.chapters.map(chapter => chapter.id)).size).toBe(seeded.length)
    expect(device.data.chapters.map(chapter => chapter.id)).toEqual(seeded.map(chapter => chapter.id))

    const secondDevice = new Device(cloud)
    await secondDevice.boot()
    expect(cloud.rows('chapters')).toHaveLength(seeded.length)
    expect(secondDevice.data.chapters.map(chapter => chapter.id)).toEqual(seeded.map(chapter => chapter.id))
  })

  it('creates the profile and settings on first sign-in and keeps them on later pulls', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    expect(device.data.profile?.display_name).toBe('Aarav')
    expect(cloud.rows('profiles')).toHaveLength(1)
    expect(cloud.rows('app_settings')).toHaveLength(1)
    expect(cloud.rows('user_exam_tracks').length).toBeGreaterThan(0)

    await device.restart()
    expect(cloud.rows('profiles')).toHaveLength(1)
    expect(cloud.rows('app_settings')).toHaveLength(1)
  })

  it('queues offline writes once per record and flushes them when the network returns', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const chapter = seedChapters(USER_ID)[0]!
    device.online = false

    const stage = emptyChapterStage(USER_ID, chapter.id, 'theory', true)
    await device.engine!.upsert('chapter_stages', stage)
    expect(device.pending).toBe(1)
    expect(device.syncState).toBe('offline')
    expect(cloud.rows('chapter_stages')).toHaveLength(0)

    // A second edit to the same record replaces the queued entry instead of adding one.
    await device.engine!.upsert('chapter_stages', { ...stage, done: false })
    expect(device.pending).toBe(1)

    device.online = true
    await device.engine!.networkChanged(true)
    expect(device.pending).toBe(0)
    expect(device.syncState).toBe('synced')
    const remote = cloud.rows('chapter_stages')
    expect(remote).toHaveLength(1)
    expect(remote[0]).toMatchObject({ id: stage.id, done: false, chapter_id: chapter.id })
  })

  it('resolves conflicts by last-write-wins on updated_at', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const chapter = seedChapters(USER_ID)[0]!
    device.online = false

    // Older local edit, made while offline.
    device.clock = Date.parse('2026-10-09T04:00:00.000Z')
    const stage = emptyChapterStage(USER_ID, chapter.id, 'notes', true)
    await device.engine!.upsert('chapter_stages', stage)

    // Another device writes a newer row to the cloud in the meantime.
    cloud.seedRow('chapter_stages', {
      ...stage, done: false, updated_at: '2026-10-09T05:00:00.000Z', completed_at: null
    })

    device.online = true
    await device.engine!.networkChanged(true)
    expect(cloud.rows('chapter_stages')[0]).toMatchObject({ done: false })
    expect(device.data.chapterStages.find(row => row.id === stage.id)).toMatchObject({ done: false })
    expect(device.pending).toBe(0)
  })

  it('keeps a newer local edit over an older cloud row', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const chapter = seedChapters(USER_ID)[0]!
    const stage = emptyChapterStage(USER_ID, chapter.id, 'pyqs', false)
    cloud.seedRow('chapter_stages', { ...stage, updated_at: '2026-10-08T00:00:00.000Z' })

    device.online = false
    device.clock = Date.parse('2026-10-09T06:00:00.000Z')
    await device.engine!.upsert('chapter_stages', { ...stage, done: true, completed_at: '2026-10-09' })
    device.online = true
    await device.engine!.networkChanged(true)
    expect(cloud.rows('chapter_stages')[0]).toMatchObject({ done: true })
  })

  it('removes a chapter with its dependants and restores all of them on undo', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const chapter = seedChapters(USER_ID)[0]!
    await device.engine!.upsert('chapter_stages', emptyChapterStage(USER_ID, chapter.id, 'theory', true))
    const stagesBefore = device.data.chapterStages.filter(row => row.chapter_id === chapter.id).length
    expect(stagesBefore).toBeGreaterThan(0)

    await device.engine!.remove('chapters', chapter)
    expect(device.undoAvailable).toBe(true)
    expect(device.data.chapters.find(row => row.id === chapter.id)).toBeUndefined()
    expect(device.data.chapterStages.filter(row => row.chapter_id === chapter.id)).toHaveLength(0)

    await device.engine!.undoDelete()
    expect(device.undoAvailable).toBe(false)
    expect(device.data.chapters.find(row => row.id === chapter.id)).toBeDefined()
    expect(device.data.chapterStages.filter(row => row.chapter_id === chapter.id)).toHaveLength(stagesBefore)
    expect(cloud.rows('chapters').find(row => row.id === chapter.id)).toBeDefined()
  })

  it('uploads a pending mistake photo once and keeps the bucket path on the record', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const chapter = seedChapters(USER_ID)[0]!
    const dataUrl = `data:image/webp;base64,${base64([82, 73, 70, 70, 1, 2, 3])}`

    await device.engine!.upsert('mistakes', {
      id: 'mistake-1', chapter_id: chapter.id, test_id: null, mistake_type: 'Concept',
      question_note: 'Q', solution_note: 'S', image_path: null, retry_later: false, retry_status: 'pending',
      image_data: dataUrl, image_pending: true, created_at: '2026-10-09T00:00:00.000Z', updated_at: '2026-10-09T00:00:00.000Z'
    } as never)

    const remote = cloud.rows('mistakes')[0]!
    expect(remote.image_path).toBe(`${USER_ID}/photo-1.webp`)
    expect(remote).not.toHaveProperty('image_data')
    expect(cloud.bucket.get(`${USER_ID}/photo-1.webp`)).toEqual(new Uint8Array([82, 73, 70, 70, 1, 2, 3]))
    expect(device.data.mistakes[0]).toMatchObject({ image_pending: false, image_path: `${USER_ID}/photo-1.webp` })
  })

  it('imports a backup without duplicating records that already exist', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const seeded = seedChapters(USER_ID)
    const renamed = { ...seeded[0]!, name: 'Renamed from backup' }

    await device.engine!.mergeImportedData({ chapters: [renamed, ...seeded.slice(1)] } as never)
    expect(device.data.chapters).toHaveLength(seeded.length)
    expect(device.data.chapters.find(row => row.id === renamed.id)?.name).toBe('Renamed from backup')
    expect(cloud.rows('chapters')).toHaveLength(seeded.length)
  })

  it('reports an error when a cloud write is rejected by the server rather than a network fault', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const original = cloud.upsert.bind(cloud)
    cloud.upsert = async (table, rows) => {
      if (table === 'practice_sessions') throw new Error('new row violates row-level security policy')
      return original(table, rows)
    }
    const chapter = seedChapters(USER_ID)[0]!
    const session = {
      id: 'practice-1', chapter_id: chapter.id, practice_date: '2026-10-09', attempted: 10, correct: 7,
      incorrect: 3, source: 'DPP', time_minutes: 20, created_at: '2026-10-09T00:00:00.000Z', updated_at: '2026-10-09T00:00:00.000Z'
    }
    await expect(device.engine!.upsert('practice_sessions', session as never)).rejects.toThrow(/cloud sync failed/)
    expect(device.syncState).toBe('error')
    // The local copy is kept, so the user does not lose the entry.
    expect(device.data.practiceSessions.find(row => row.id === 'practice-1')).toBeDefined()
  })
})
