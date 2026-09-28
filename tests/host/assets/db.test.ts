// tests/host/assets/db.test.ts
//
// 资产库初始化契约：库文件位置、建表幂等、跨连接可见（重开不丢数据）、关闭后的行为。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASSET_DB_FILE, AssetStore } from '../../../src/host/assets/index.js'
import { fakeClock, fakeIds, makeStore, removeTempRoot, roleTemplate } from './fixtures/asset-fixture.js'

let store: AssetStore
let root: string

beforeEach(async () => {
  const created = await makeStore()
  store = created.store
  root = created.root
})

afterEach(async () => {
  store.close()
  await removeTempRoot(root)
})

describe('初始化', () => {
  it('test_初始化_库文件固定落在root下assets_db', () => {
    expect(existsSync(join(root, ASSET_DB_FILE))).toBe(true)
  })

  it('test_初始化_重复调用_幂等且不影响既有数据', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })

    await store.init()
    await store.init()

    const detail = await store.getRoleAsset(promoted.assetId)
    expect(detail?.versionId).toBe(1)
    expect(await store.listRoleVersions(promoted.assetId)).toHaveLength(1)
  })

  it('test_重建store_同一库文件_数据仍在', async () => {
    const promoted = await store.promoteRole({
      templateId: 'tpl-1',
      fingerprint: 'fp-1',
      role: roleTemplate(),
      source: 'human',
    })
    store.close()

    const reopened = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    await reopened.init()
    try {
      const detail = await reopened.getRoleAsset(promoted.assetId)
      expect(detail?.name).toBe('研究员')
      expect(detail?.rowId).toBe(promoted.rowId)
    } finally {
      reopened.close()
    }
  })

  it('test_未初始化_写操作_给出可行动错误', async () => {
    const fresh = new AssetStore(root, { now: fakeClock(), ids: fakeIds() })
    await expect(
      fresh.promoteRole({ templateId: 'tpl-1', fingerprint: 'fp-1', role: roleTemplate(), source: 'human' }),
    ).rejects.toThrow(/尚未初始化/)
  })
})
