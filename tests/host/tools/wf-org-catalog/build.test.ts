// tests/host/tools/wf-org-catalog/build.test.ts
//
// 索引 / 详情装配纯函数单测：
//   - 索引：组合携带完整工具清单、模型携带思考强度档位、角色只给摘要、模板给描述、规则与 ID 约定同源；
//   - 骨架：阶段节点 / 角色 / 协作组 / 虚拟节点 / 数据节点正文 / 连接信息脱敏 / 连线 / 可召回内联角色清单；
//   - 骨架的字段取舍：角色 systemPrompt 必须缺席（走按需召回），其余不可召回内容必须给全；
//   - 角色与内联角色详情：systemPrompt 完整不截断，并标明所属工作流与节点。

import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  buildInlineRoleDetail,
  buildRoleDetail,
  buildWorkflowDetail,
  clip,
  maskConnection,
} from '../../../../src/host/tools/wf-org-catalog/build.js'
import { CATALOG_LIMITS, ID_CONVENTION } from '../../../../src/host/tools/wf-org-catalog/types.js'
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from '../../../../src/host/prompts/index.js'
import { makeCatalogHost, roleTemplateFixture, templateFixture } from './fixtures.js'
import type { CatalogIndex, CatalogRoleNodeEntry, CatalogWorkflowDetail } from '../../../../src/host/tools/wf-org-catalog/types.js'
import type { RoleNode } from '../../../../src/host/shared/graph-model.js'

/** 取骨架里的角色节点条目（测试专用窄化）。 */
function roleNodeOf(detail: CatalogWorkflowDetail, id: string): CatalogRoleNodeEntry {
  return detail.nodes.find((node) => node.id === id && (node.kind === 'agent' || node.kind === 'parent')) as CatalogRoleNodeEntry
}

/** 取内联角色清单里的样本节点（buildInlineRoleDetail 入参）。 */
function roleNodeFixture(): RoleNode {
  return templateFixture().nodes.find((node) => node.id === 'a1') as RoleNode
}

describe('buildIndex（资产索引装配）', () => {
  const hostFixture = makeCatalogHost()

  it('索引只含约定字段（不含版本类型的预算 / 规模 / 数据源 / 工具开关字段）', () => {
    const index = buildIndex({
      roles: [roleTemplateFixture()],
      combos: [],
      presets: [],
      models: [],
      templates: [],
    })
    expect(Object.keys(index).sort()).toEqual(
      ['combos', 'detailHint', 'idConvention', 'kind', 'models', 'presets', 'roles', 'rules', 'templates', 'truncated'].sort(),
    )
    expect(index.kind).toBe('index')
  })

  it('规则段与提示词基线的常量同源（不在工具层复制文本）', () => {
    const index = buildIndex({ roles: [], combos: [], presets: [], models: [], templates: [] })
    expect(index.rules.graphSemantics).toBe(ORG_SOP_L1_GRAPH_SEMANTICS)
    expect(index.rules.designMethod).toBe(ORG_SOP_DESIGN_METHOD)
    expect(index.idConvention).toEqual(ID_CONVENTION)
  })

  it('组合条目携带完整工具清单（不截断：它是节点 presetId 的取值依据）', () => {
    const tools = Array.from({ length: 60 }, (_item, i) => `tool-${i}`)
    const index = buildIndex({
      roles: [],
      combos: [{ id: 'combo-x', name: '大组合', tools, mcpServers: ['srv'] }],
      presets: [],
      models: [],
      templates: [],
    })
    expect(index.combos[0].tools).toHaveLength(60)
    expect(index.combos[0].mcpServers).toEqual(['srv'])
  })

  it('模型条目携带 provider/model 与思考强度档位；无档位时省略该字段', () => {
    const index = buildIndex({
      roles: [],
      combos: [],
      presets: [],
      models: [
        { provider: 'deepseek', model: 'chat', efforts: [{ id: 'high', name: '高' }] },
        { provider: 'deepseek', model: 'flash' },
      ],
      templates: [],
    })
    expect(index.models[0]).toEqual({ provider: 'deepseek', model: 'chat', efforts: [{ id: 'high', name: '高' }] })
    expect('efforts' in index.models[1]).toBe(false)
  })

  it('角色条目只给 id/name/kind/摘要（摘要截断，且不带 presetId 等配置字段）', () => {
    const index = buildIndex({
      roles: [roleTemplateFixture('role-1', '分析员', '长'.repeat(200))],
      combos: [],
      presets: [],
      models: [],
      templates: [],
    })
    const role = index.roles[0]
    expect(Object.keys(role).sort()).toEqual(['id', 'kind', 'name', 'summary'])
    expect(role.summary.length).toBeLessThanOrEqual(CATALOG_LIMITS.roleSummary + 8)
  })

  it('模板条目给 id/name/描述', () => {
    const index = buildIndex({ roles: [], combos: [], presets: [], models: [], templates: [templateFixture()] })
    expect(index.templates[0]).toEqual({ id: 'tpl-1', name: '模板一', description: '模板描述' })
  })

  it('preset 条目带描述（能看出它能给什么）', () => {
    const index = buildIndex({
      roles: [],
      combos: [],
      presets: [{ id: 'standard', name: '标准', description: '官方标准模式' }],
      models: [],
      templates: [],
    })
    expect(index.presets[0]).toEqual({ id: 'standard', name: '标准', description: '官方标准模式' })
  })

  it('条目超量：按上限截断并置 truncated（不静默丢弃）', () => {
    const roles = Array.from({ length: CATALOG_LIMITS.roles + 5 }, (_item, i) => roleTemplateFixture(`role-${i}`))
    const index = buildIndex({ roles, combos: [], presets: [], models: [], templates: [] })
    expect(index.roles).toHaveLength(CATALOG_LIMITS.roles)
    expect(index.truncated).toBe(true)
  })

  it('未超量：truncated=false 且清单原样', () => {
    const index: CatalogIndex = buildIndex({ roles: [roleTemplateFixture()], combos: [], presets: [], models: [], templates: [] })
    expect(index.truncated).toBe(false)
    expect(index.roles).toHaveLength(1)
  })

  it('宿主 fake 的 preset/模型目录可被工具层取到（装配契约不回归）', async () => {
    const presets = await hostFixture.host.listPresets?.()
    const models = await hostFixture.host.listModels?.()
    expect(presets?.[0].id).toBe('standard')
    expect(models?.[0].efforts?.[0].id).toBe('high')
  })
})

describe('buildWorkflowDetail（骨架自足性）', () => {
  const detail = buildWorkflowDetail(templateFixture())

  it('返回体只含骨架约定字段（meta 存在时才有 meta）', () => {
    expect(Object.keys(detail).sort()).toEqual(
      ['description', 'id', 'inlineRoles', 'lines', 'meta', 'mode', 'name', 'nodes', 'note', 'revision', 'type'].sort(),
    )
    expect(detail.meta).toEqual({ nodeMax: 12 })
    const withoutMeta = buildWorkflowDetail(templateFixture({ meta: undefined }))
    expect('meta' in withoutMeta).toBe(false)
  })

  it('阶段节点（start/pause/end）都在骨架里', () => {
    const kinds = detail.nodes.filter((node) => node.kind === 'start' || node.kind === 'pause' || node.kind === 'end')
    expect(kinds.map((node) => node.id).sort()).toEqual(['e', 'pz', 's'])
  })

  it('角色节点给全不可召回字段，但**不含 systemPrompt**', () => {
    const role = roleNodeOf(detail, 'a1')
    expect(Object.keys(role).sort()).toEqual(
      ['groupId', 'id', 'inputSchema', 'kind', 'label', 'model', 'outputSchema', 'presetId', 'provider', 'reasoning', 'systemPromptSource'].sort(),
    )
    expect(role.presetId).toBe('combo-1')
    expect(role.reasoning).toBe('high')
    expect(role.groupId).toBe('g1')
    expect(role.systemPromptSource).toBe('角色说明.md')
    expect('systemPrompt' in role).toBe(false)
  })

  it('协作组节点给全 collabPrompt 与成员清单', () => {
    const group = detail.nodes.find((node) => node.id === 'g1')
    expect(group).toEqual({ id: 'g1', kind: 'group', label: '评审组', collabPrompt: '组员互相评审', memberIds: ['a1'] })
  })

  it('虚拟节点给出引用主节点与闸门角色', () => {
    const proxy = detail.nodes.find((node) => node.id === 'p1')
    expect(proxy).toEqual({ id: 'p1', kind: 'proxy', label: '里程碑复核', proxySourceId: 'a1', role: 'milestone' })
  })

  it('文件节点正文一次性给全（没有二次召回通道）', () => {
    const file = detail.nodes.find((node) => node.id === 'f1')
    expect(file).toMatchObject({ kind: 'file', label: '基线说明', fileKind: 'text', content: '基线正文' })
  })

  it('数据库节点连接信息给全，但密码脱敏', () => {
    const server = detail.nodes.find((node) => node.id === 'db2')
    expect(server).toMatchObject({ kind: 'database', dbType: 'server', dbKind: 'postgresql' })
    expect((server as { conn: Record<string, unknown> }).conn).toEqual({
      host: 'db.internal',
      port: 5432,
      user: 'reader',
      password: '**',
      db: 'shop',
    })
  })

  it('连线给全（含条件类型）', () => {
    expect(detail.lines).toHaveLength(4)
    expect(detail.lines.find((line) => line.id === 'l3')?.condition).toEqual({ type: 'fail' })
    expect(detail.lines.find((line) => line.id === 'l2')).toMatchObject({ sourceHandle: 'ctx-out', targetHandle: 'ctx-in' })
  })

  it('inlineRoles 列出可召回的复合 id（仅角色节点）', () => {
    expect(detail.inlineRoles).toEqual(['tpl-1#a1'])
    expect(detail.note).toContain('systemPrompt')
  })
})

describe('buildRoleDetail / buildInlineRoleDetail（systemPrompt 完整召回）', () => {
  it('角色模板：systemPrompt 不截断，来源文件名随详情给出，缺省字段省略', () => {
    const long = '提'.repeat(5000)
    const detail = buildRoleDetail(roleTemplateFixture('role-1', '分析员', long))
    expect(detail.systemPrompt).toHaveLength(5000)
    expect(detail.reasoning).toBe('high')
    expect(detail.systemPromptSource).toBe('分析员.md')
    const withoutOptional = buildRoleDetail({ id: 'role-2', name: '无推理档', systemPrompt: 'x' })
    expect('reasoning' in withoutOptional).toBe(false)
    expect('systemPromptSource' in withoutOptional).toBe(false)
    expect(withoutOptional.presetId).toBeNull()
  })

  it('内联角色：标明所属工作流与节点，systemPrompt 完整', () => {
    const detail = buildInlineRoleDetail({ containerId: 'tpl-1', node: roleNodeFixture() })
    expect(detail.type).toBe('inlineRole')
    expect(detail.id).toBe('tpl-1#a1')
    expect(detail.containerId).toBe('tpl-1')
    expect(detail.nodeId).toBe('a1')
    expect(detail.label).toBe('分析员')
    expect(detail.systemPrompt).toBe('你是分析员')
    expect(detail.groupId).toBe('g1')
    expect(detail.systemPromptSource).toBe('角色说明.md')
  })
})

describe('maskConnection / clip（辅助纯函数）', () => {
  it('只有密钥字段被替换，其余字段原样保留', () => {
    expect(maskConnection({ host: 'h', password: 'p', token: 't' })).toEqual({ host: 'h', password: '**', token: 't' })
  })

  it('非对象 / 空值 → undefined（调用方据此省略字段）', () => {
    expect(maskConnection(null)).toBeUndefined()
    expect(maskConnection('x')).toBeUndefined()
    expect(maskConnection([1, 2])).toBeUndefined()
  })

  it('clip：空白压缩 + 超限标注', () => {
    expect(clip('  a\n\nb  ', 10)).toBe('a b')
    expect(clip('x'.repeat(20), 5)).toBe('xxxxx…（已截断）')
  })
})
