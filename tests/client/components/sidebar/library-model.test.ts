// tests/client/components/sidebar/library-model.test.ts
//
// buildLibraryModel 单测：
//   ① P4 体验与沉淀：父代理模板卡 pinned=false，不再常驻 is-pinned 高亮；
//   ② 资产态分区（工作流资产 / 角色资产各一区，不再按实例/模版或父/子代理分区）、
//      资产卡片 payload（工作流资产 → 打开画布文档；角色资产 → 属性栏 / 拖入画布）；
//   ③ 搜索过滤（名称 + 描述 / 角色提示词，大小写不敏感、trim）与空态文案。
//
// 注（治理）：本文件原为 tests/client/p4-experience.test.tsx 的一部分，结构治理后
// 按源文件归属拆分——library-model 用例归入本文件。

import { describe, expect, it, vi } from 'vitest'
import { buildLibraryModel, type LibraryModelInput } from '../../../../src/client/components/sidebar/library-model.js'
import { zh } from '../../../../src/client/i18n.js'

/** builder 输入工厂（只覆盖被测字段，其余为最小缺省）。 */
function makeInput(partial: Partial<LibraryModelInput> = {}): LibraryModelInput {
  return {
    copy: zh,
    libTab: 'workflow',
    mode: 'mode1',
    workflows: [],
    currentSessionId: 's-1',
    flowTemplates: [],
    parentTemplate: null,
    roleTemplates: [],
    fileTemplates: [],
    databaseTemplates: [],
    groupTemplates: [],
    stageKinds: [],
    libSelection: null,
    modeName: () => '标准',
    onSelectWorkflow: () => {},
    onSelectFlowTemplate: () => {},
    onSelectLib: () => {},
    onPlaceTemplate: () => {},
    onPlaceTemplateIntoGroup: () => {},
    onPlaceStage: () => {},
    onPlaceGroup: () => {},
    onPlaceGroupFromTemplate: () => {},
    onPlaceParent: () => {},
    onCreateNew: () => {},
    ...partial,
  }
}

function workflowAsset(assetId: string, name: string, description = ''): NonNullable<LibraryModelInput['assets']>['workflows'][number] {
  return { assetId, versionId: 1, name, description, updatedAt: 1 }
}

function roleAsset(assetId: string, name: string, kind: 'parent' | 'agent' = 'agent'): NonNullable<LibraryModelInput['assets']>['roles'][number] {
  return { assetId, versionId: 2, name, kind, roleAssetType: 'standalone', updatedAt: 1 }
}
describe('P4 父模板卡高亮修复（buildLibraryModel）', () => {
  it('父代理模板卡 pinned=false（不再常驻 is-pinned 高亮）', () => {
    const model = buildLibraryModel(makeInput({
      libTab: 'role',
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
    }))
    const parent = model.sections.find((section) => section.key === 'parent')
    expect(parent?.cards[0].pinned).toBe(false)
  })
})

describe('资产态分区（模版 / 资产来源切换）', () => {
  it('工作流 Tag：只有工作流资产一个分区（不再分区实例 + 工作流模版）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      workflows: [{ id: 'flow-1', name: '实例一' }],
      flowTemplates: [{ id: 'tpl-1', name: '模版一' } as never],
      assets: { workflows: [workflowAsset('a-1', '资产一', '描述一')], roles: [] },
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['assetWorkflows'])
    const section = model.sections[0]
    expect(section.title).toBe(zh.assetWorkflows)
    expect(section.plus).toBe(false)
    expect(section.cards.map((card) => card.name)).toEqual(['资产一'])
    expect(section.cards[0].kind).toBe('flowAsset')
  })

  it('角色 Tag：只有角色资产一个分区（不再分区父代理 / 角色模版）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      parentTemplate: { id: 'tpl-parent', name: 'CEO' } as never,
      roleTemplates: [{ id: 'r-1', name: '研究', systemPrompt: '' } as never],
      assets: { workflows: [], roles: [roleAsset('a-r1', '资产角色'), roleAsset('a-r2', '资产父代理', 'parent')] },
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['assetRoles'])
    expect(model.sections[0].title).toBe(zh.assetRoles)
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产角色', '资产父代理'])
    // 父代理资产副行标注父代理；普通资产副行标注资产种类
    expect(model.sections[0].cards[1].sub).toBe(zh.parentAgent)
    expect(model.sections[0].cards[0].sub).toBe(zh.roleAssetType.standalone)
  })

  it('数据 / 其他 Tag：无分区 + 整页空态提示（V1 资产只含工作流与角色）', () => {
    for (const libTab of ['data', 'other'] as const) {
      const model = buildLibraryModel(makeInput({ librarySource: 'asset', libTab }))
      expect(model.sections).toEqual([])
      expect(model.emptyHint).toBe(zh.assetListNotSupported)
    }
  })

  it('资产为空：分区保留但卡片为空，空态文案为「资产只能由模版入库晋升」', () => {
    const model = buildLibraryModel(makeInput({ librarySource: 'asset', libTab: 'workflow', assets: { workflows: [], roles: [] } }))
    expect(model.sections[0].cards).toEqual([])
    expect(model.sections[0].emptyText).toBe(zh.assetEmptyHint)
  })

  it('模版态缺省（未传 librarySource）：保持既有实例 + 工作流模版两分区', () => {
    const model = buildLibraryModel(makeInput({
      workflows: [{ id: 'flow-1', name: '实例一' }],
      flowTemplates: [{ id: 'tpl-1', name: '模版一' } as never],
      assets: { workflows: [workflowAsset('a-1', '资产一')], roles: [] },
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
  })
})

describe('资产卡片 payload（拖拽 / 打开）', () => {
  it('工作流资产：点击与拖入都打开资产文档（画布文档 = 资产）', () => {
    const onSelectFlowAsset = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: { workflows: [workflowAsset('a-1', '资产一')], roles: [] },
      onSelectFlowAsset,
    }))
    const payload = model.sections[0].cards[0].payload
    expect(payload.label).toBe('资产一')
    payload.onClick()
    payload.onDrop({ x: 10, y: 20 })
    expect(onSelectFlowAsset.mock.calls).toEqual([['a-1'], ['a-1']])
  })

  it('角色资产：点击进属性栏；拖入画布携带落点坐标', () => {
    const onOpenRoleAsset = vi.fn()
    const onPlaceRoleAsset = vi.fn()
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      assets: { workflows: [], roles: [roleAsset('a-r1', '资产角色')] },
      onOpenRoleAsset,
      onPlaceRoleAsset,
    }))
    const payload = model.sections[0].cards[0].payload
    payload.onClick()
    payload.onDrop({ x: 88, y: 99 })
    expect(onOpenRoleAsset).toHaveBeenCalledWith('a-r1')
    expect(onPlaceRoleAsset).toHaveBeenCalledWith('a-r1', { x: 88, y: 99 })
    // 落点缺省时使用默认格点（与模版拖入同口径）
    payload.onDrop()
    expect(onPlaceRoleAsset).toHaveBeenLastCalledWith('a-r1', { x: 120, y: 80 })
    // 角色资产不入组（V1 只支持拖到画布）
    expect(payload.onDropIntoGroup).toBeUndefined()
  })
})

describe('库搜索过滤（两态共用同一关键词）', () => {
  const roleTemplates = [
    { id: 'r-1', name: '研究员', systemPrompt: '负责调研与归档' },
    { id: 'r-2', name: 'Writer', systemPrompt: '负责写稿' },
  ] as never

  it('模版态：名称 + 描述命中（大小写不敏感、首尾空白忽略）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '  writer  ',
      libTab: 'role',
      roleTemplates,
    }))
    const cards = model.sections.flatMap((section) => section.cards)
    expect(cards.map((card) => card.name)).toEqual(['Writer'])
  })

  it('模版态：角色提示词命中（角色 System Prompt 属可搜索字段）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '归档',
      libTab: 'role',
      roleTemplates,
    }))
    expect(model.sections.flatMap((section) => section.cards).map((card) => card.name)).toEqual(['研究员'])
  })

  it('模版态：过滤实例列表与工作流模版列表（全部分区）', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '甲',
      workflows: [{ id: 'flow-1', name: '甲方流程', description: '' }, { id: 'flow-2', name: '乙方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲', description: '' }, { id: 'tpl-2', name: '模板乙' }] as never,
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['甲方流程'])
    expect(model.sections[1].cards.map((card) => card.name)).toEqual(['模板甲'])
  })

  it('资产态：按资产名称过滤；角色资产命中', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'workflow',
      libSearch: '资',
      assets: { workflows: [workflowAsset('a-1', '资产一'), workflowAsset('a-2', '别的')], roles: [] },
    }))
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产一'])
  })

  it('资产态角色：搜索命中职责摘要（summary = 提示词前 60 字）', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      libSearch: '归档',
      assets: {
        workflows: [],
        roles: [
          { ...roleAsset('a-r1', '资产角色'), summary: '负责调研与归档' },
          { ...roleAsset('a-r2', '另一个角色'), summary: '负责写稿' },
        ],
      },
    }))
    expect(model.sections[0].cards.map((card) => card.name)).toEqual(['资产角色'])
  })

  it('资产态角色：名称与摘要都不命中 → 整页无结果空态', () => {
    const model = buildLibraryModel(makeInput({
      librarySource: 'asset',
      libTab: 'role',
      libSearch: '不存在的关键词',
      assets: { workflows: [], roles: [{ ...roleAsset('a-r1', '资产角色'), summary: '负责调研与归档' }] },
    }))
    expect(model.sections).toEqual([])
    expect(model.emptyHint).toBe(zh.searchNoResult)
  })

  it('搜索无命中：整页空态为「没有匹配的条目」，且不残留空分区', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '不存在的关键词',
      workflows: [{ id: 'flow-1', name: '甲方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲' } as never],
    }))
    expect(model.emptyHint).toBe(zh.searchNoResult)
    expect(model.sections).toEqual([])
  })

  it('空关键词（含全空白）不过滤：分区与卡片保持原样、无整页空态', () => {
    const model = buildLibraryModel(makeInput({
      libSearch: '   ',
      workflows: [{ id: 'flow-1', name: '甲方流程' }],
      flowTemplates: [{ id: 'tpl-1', name: '模板甲' } as never],
    }))
    expect(model.sections.map((section) => section.key)).toEqual(['instances', 'flowTemplates'])
    expect(model.emptyHint).toBeNull()
  })
})

