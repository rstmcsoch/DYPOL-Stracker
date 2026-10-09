import { FakeCloud } from './support/fake-cloud'
import { Device, USER_ID } from './support/harness'

describe('account reset', () => {
  it('erases this owner’s cloud rows and photos, then clears the device, and leaves other owners alone', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    expect(cloud.rows('chapters').length).toBeGreaterThan(0)

    cloud.bucket.set(`${USER_ID}/photo-a.webp`, new Uint8Array([1, 2, 3]))
    cloud.bucket.set('someone-else/photo.webp', new Uint8Array([9]))
    cloud.seedRow('chapters', { id: 'other-owner-chapter', user_id: 'someone-else', name: 'Other', subject: 'Physics' })

    await device.engine!.resetAccount()

    for (const table of ['chapters', 'app_settings', 'profiles'] as const) {
      expect(cloud.rows(table).filter(row => row.user_id === USER_ID)).toHaveLength(0)
    }
    expect([...cloud.bucket.keys()]).toEqual(['someone-else/photo.webp'])
    expect(cloud.rows('chapters').map(row => row.id)).toEqual(['other-owner-chapter'])
    expect(device.data.chapters).toHaveLength(0)
    expect(await device.store.listQueue(USER_ID)).toHaveLength(0)
  })

  it('refuses to reset while offline and leaves both the cloud copy and the device intact', async () => {
    const cloud = new FakeCloud()
    const device = new Device(cloud)
    await device.boot()
    const before = cloud.rows('chapters').length
    expect(before).toBeGreaterThan(0)

    device.online = false
    cloud.online = false
    await expect(device.engine!.resetAccount()).rejects.toThrow(/connection/)

    cloud.online = true
    expect(cloud.rows('chapters')).toHaveLength(before)
    expect(device.data.chapters).toHaveLength(before)
  })
})
