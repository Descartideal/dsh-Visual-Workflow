// tests/host/assets/ids.test.ts
//
// id 生成纯函数测试：前缀契约、注入随机源的确定性、版本行 id 的格式契约。

import { describe, expect, it } from 'vitest'
import {
  newExperienceId,
  newRoleAssetId,
  newWorkflowAssetId,
  versionRowId,
} from '../../../src/host/assets/ids.js'
import { fakeIds } from './fixtures/asset-fixture.js'

describe('id 前缀契约', () => {
  it('test_角色资产id_前缀为role且同序确定', () => {
    const deps = fakeIds()
    expect(newRoleAssetId(deps)).toBe('role-1-00000000')
    expect(newRoleAssetId(deps)).toBe('role-2-00000000')
  })

  it('test_工作流资产id_前缀为flow', () => {
    expect(newWorkflowAssetId(fakeIds())).toMatch(/^flow-1-00000000$/)
  })

  it('test_经验id_前缀为ex', () => {
    expect(newExperienceId(fakeIds())).toMatch(/^ex-1-00000000$/)
  })

  it('test_id生成_随机段为32位十六进制（跨重启同序号位靠它区分）', () => {
    // 4 位（16 位随机）在长期「每次启动都入库」的使用下会撞号（主键冲突），故固定 8 位
    expect(newRoleAssetId({ sequence: () => 1, random: () => 0.5 })).toMatch(/^role-1-[0-9a-f]{8}$/)
  })

  it('test_id生成_同随机源与序号_产出完全一致', () => {
    expect(newRoleAssetId(fakeIds())).toBe(newRoleAssetId(fakeIds()))
  })
})

describe('versionRowId（版本行 id）', () => {
  it('test_版本行id_格式为资产id@版本号', () => {
    expect(versionRowId('role-abc', 3)).toBe('role-abc@3')
  })

  it('test_版本行id_同一资产不同版本_互不相同', () => {
    expect(versionRowId('flow-1', 1)).not.toBe(versionRowId('flow-1', 2))
  })
})
