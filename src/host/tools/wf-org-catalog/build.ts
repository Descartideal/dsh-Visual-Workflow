// src/host/tools/wf-org-catalog/build.ts
//
// wf_org_catalog 的**纯函数装配层**：把工具层已取到的数据组装成索引/详情返回体。
// 不触盘、不读时钟、不读全局——同一入参必同输出。
//
// 关键契约（用户裁决）：骨架必须自足——不可二次召回的内容（阶段节点、协作组配置、
// 连线、数据节点正文与连接信息）一次性给全，保证「索引 + 多次详情召回」能拼出与
// 工作流文件等价的完整信息；**唯一按需召回的长字段是角色 systemPrompt**，由骨架里的
// 复合 id 指向。

import { labelOf } from '../../orchestrator/index.js'
import { ORG_SOP_DESIGN_METHOD, ORG_SOP_L1_GRAPH_SEMANTICS } from '../../prompts/index.js'
import { GATE_MARKING_SEMANTICS, PATCH_CONTRACT_TEXT } from '../infrastructure/graph-op-contract.js'
import { CATALOG_LIMITS, ID_CONVENTION, INLINE_ROLE_SEPARATOR } from './types.js'
import type {
  CatalogComboEntry,
  CatalogDatabaseNodeEntry,
  CatalogFileNodeEntry,
  CatalogGroupNodeEntry,
  CatalogIndex,
  CatalogInlineRoleDetail,
  CatalogLineEntry,
  CatalogModelEntry,
  CatalogModelSource,
  CatalogNodeEntry,
  CatalogPresetEntry,
  CatalogPresetSource,
  CatalogProxyNodeEntry,
  CatalogRoleDetail,
  CatalogRoleEntry,
  CatalogRoleNodeEntry,
  CatalogStageNodeEntry,
  CatalogTemplateEntry,
  CatalogWorkflowDetail,
} from './types.js'
import type { GraphNode, Line, RoleNode, WorkflowTemplate } from '../../shared/graph-model.js'

/** 索引里的召回指引：目录是候选清单而非全部内容，详情按 ids 召回。 */
export const DETAIL_HINT =
  '再次调用本工具并传 ids 可召回详情：["tpl-xxx"]=工作流完整骨架；["role-xxx"]=角色完整 systemPrompt；'
  + '["tpl-xxx#node-yyy"]=该工作流模板内联角色的完整 systemPrompt。'
  + '骨架已含阶段节点、协作组配置、连线与数据节点正文（这些没有二次召回通道），'
  + '唯一按需召回的长字段是角色 systemPrompt。ids 中的坏 id 只单条报错，不影响其余。'

/** 骨架返回体里的提示：角色提示词走复合 id 按需召回。 */
export const WORKFLOW_DETAIL_NOTE =
  'nodes 中角色节点（kind=agent|parent）的 systemPrompt 未包含：按 inlineRoles 里的复合 id 逐个召回。'

/** 数据库连接里不进模型上下文的密钥字段。 */
const SECRET_CONNECTION_KEYS = ['password'] as const

/** 文本截断（空白压缩 + 超限标注，供角色摘要等短字段使用）。 */
export function clip(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…（已截断）` : text
}

/** 数组预算：超限截断并返回是否截断。 */
function clipList<T>(items: T[], limit: number): { items: T[]; truncated: boolean } {
  return items.length > limit ? { items: items.slice(0, limit), truncated: true } : { items, truncated: false }
}

/** 宽松字符串化（null/undefined → 空串）。 */
function textOf(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** 非空 trim 后字符串（无内容返回 null，便于按需省略字段）。 */
function trimmedOrNull(value: unknown): string | null {
  const text = textOf(value).trim()
  return text ? text : null
}

/** 组装资产索引（第一次调用）。 */
export function buildIndex(input: {
  roles: Array<Record<string, unknown>>
  combos: Array<Record<string, unknown>>
  presets: CatalogPresetSource[]
  models: CatalogModelSource[]
  templates: WorkflowTemplate[]
}): CatalogIndex {
  const roleEntries = input.roles.map(roleEntryOf).filter((entry) => entry.id)
  const comboEntries = input.combos.map(comboEntryOf).filter((entry) => entry.id)
  const presetEntries = input.presets.map(presetEntryOf).filter((entry) => entry.id)
  const modelEntries = input.models.map(modelEntryOf).filter((entry) => entry.provider || entry.model)
  const templateEntries = input.templates.map(templateEntryOf).filter((entry) => entry.id)
  const roles = clipList(roleEntries, CATALOG_LIMITS.roles)
  const combos = clipList(comboEntries, CATALOG_LIMITS.combos)
  const presets = clipList(presetEntries, CATALOG_LIMITS.presets)
  const models = clipList(modelEntries, CATALOG_LIMITS.models)
  const templates = clipList(templateEntries, CATALOG_LIMITS.templates)
  return {
    kind: 'index',
    idConvention: ID_CONVENTION,
    detailHint: DETAIL_HINT,
    combos: combos.items,
    presets: presets.items,
    models: models.items,
    roles: roles.items,
    templates: templates.items,
    rules: {
      graphSemantics: ORG_SOP_L1_GRAPH_SEMANTICS,
      designMethod: ORG_SOP_DESIGN_METHOD,
      patchContract: PATCH_CONTRACT_TEXT,
      gateMarking: GATE_MARKING_SEMANTICS,
    },
    truncated: roles.truncated || combos.truncated || presets.truncated || models.truncated || templates.truncated,
  }
}

function roleEntryOf(role: Record<string, unknown>): CatalogRoleEntry {
  return {
    id: textOf(role.id),
    name: textOf(role.name),
    kind: role.kind === 'parent' ? 'parent' : 'agent',
    summary: clip(role.systemPrompt ?? role.description ?? '', CATALOG_LIMITS.roleSummary),
  }
}

/**
 * 组合条目：工具清单**不截断**——组合 id 是节点 presetId 的唯一取值来源，
 * 截断会让父代理基于残缺工具集选错组合。
 */
function comboEntryOf(combo: Record<string, unknown>): CatalogComboEntry {
  return {
    id: textOf(combo.id),
    name: textOf(combo.name),
    tools: Array.isArray(combo.tools) ? (combo.tools as unknown[]).map(textOf).filter(Boolean) : [],
    mcpServers: Array.isArray(combo.mcpServers) ? (combo.mcpServers as unknown[]).map(textOf).filter(Boolean) : [],
  }
}

function presetEntryOf(preset: CatalogPresetSource): CatalogPresetEntry {
  const description = textOf(preset.description).trim()
  return {
    id: textOf(preset.id),
    name: textOf(preset.name) || textOf(preset.id),
    ...(description ? { description } : {}),
  }
}

function modelEntryOf(model: CatalogModelSource): CatalogModelEntry {
  const efforts = Array.isArray(model.efforts)
    ? model.efforts
      .map((effort) => ({ id: textOf(effort?.id), name: textOf(effort?.name) || textOf(effort?.id) }))
      .filter((effort) => effort.id)
    : []
  return {
    provider: textOf(model.provider),
    model: textOf(model.model),
    ...(efforts.length > 0 ? { efforts } : {}),
  }
}

function templateEntryOf(template: WorkflowTemplate): CatalogTemplateEntry {
  return {
    id: textOf(template.id),
    name: textOf(template.name) || textOf(template.id),
    description: textOf(template.description),
  }
}

/** 组装工作流骨架（`tpl-*` 的返回体）。 */
export function buildWorkflowDetail(template: WorkflowTemplate): CatalogWorkflowDetail {
  const nodes = (template.nodes ?? []) as GraphNode[]
  const id = textOf(template.id)
  return {
    type: 'workflow',
    id,
    name: textOf(template.name) || id,
    description: textOf(template.description),
    mode: template.mode === 'mode2' ? 'mode2' : 'mode1',
    revision: Number(template.revision) || 0,
    ...(template.meta && Object.keys(template.meta).length > 0 ? { meta: template.meta } : {}),
    nodes: nodes.map(nodeEntryOf),
    lines: (template.lines ?? []).map(lineEntryOf),
    inlineRoles: nodes
      .filter((node) => node.kind === 'agent' || node.kind === 'parent')
      .map((node) => `${id}${INLINE_ROLE_SEPARATOR}${node.id}`),
    note: WORKFLOW_DETAIL_NOTE,
  }
}

/** 组装角色模板详情（systemPrompt 完整返回，不截断）。 */
export function buildRoleDetail(role: Record<string, unknown>): CatalogRoleDetail {
  const reasoning = trimmedOrNull(role.reasoning)
  const promptSource = trimmedOrNull(role.systemPromptSource)
  return {
    type: 'role',
    id: textOf(role.id),
    name: textOf(role.name) || textOf(role.id),
    kind: role.kind === 'parent' ? 'parent' : 'agent',
    presetId: trimmedOrNull(role.presetId),
    provider: textOf(role.provider),
    model: textOf(role.model),
    ...(reasoning ? { reasoning } : {}),
    inputSchema: textOf(role.inputSchema),
    outputSchema: textOf(role.outputSchema),
    ...(promptSource ? { systemPromptSource: promptSource } : {}),
    systemPrompt: textOf(role.systemPrompt),
  }
}

/** 组装模板内联角色详情（标明所属工作流与节点，避免多角色召回时混淆）。 */
export function buildInlineRoleDetail(input: { containerId: string; node: RoleNode }): CatalogInlineRoleDetail {
  const data = input.node.data
  const reasoning = trimmedOrNull(data.reasoning)
  const promptSource = trimmedOrNull(data.systemPromptSource)
  return {
    type: 'inlineRole',
    id: `${input.containerId}${INLINE_ROLE_SEPARATOR}${input.node.id}`,
    containerId: input.containerId,
    nodeId: input.node.id,
    label: textOf(data.label),
    presetId: trimmedOrNull(data.presetId),
    provider: textOf(data.provider),
    model: textOf(data.model),
    ...(reasoning ? { reasoning } : {}),
    inputSchema: textOf(data.inputSchema),
    outputSchema: textOf(data.outputSchema),
    groupId: data.groupId ?? null,
    ...(promptSource ? { systemPromptSource: promptSource } : {}),
    systemPrompt: textOf(data.systemPrompt),
  }
}

/**
 * 数据库连接脱敏：密钥字段替换为占位符，其余字段原样保留（保证模板可复用）。
 * 为什么必须脱敏：连接信息没有二次召回通道，必须一次性给出；而密码一旦进入模型
 * 上下文与对话历史就无法收回。
 */
export function maskConnection(conn: unknown): Record<string, unknown> | undefined {
  if (!conn || typeof conn !== 'object' || Array.isArray(conn)) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(conn as Record<string, unknown>)) {
    out[key] = SECRET_CONNECTION_KEYS.includes(key as (typeof SECRET_CONNECTION_KEYS)[number]) ? '**' : value
  }
  return out
}

/** 节点条目（按 kind 判别；字段取舍见 CatalogNodeEntry 的说明）。 */
function nodeEntryOf(node: GraphNode): CatalogNodeEntry {
  switch (node.kind) {
    case 'start':
    case 'end':
    case 'pause': {
      const entry: CatalogStageNodeEntry = { id: node.id, kind: node.kind, label: labelOf(node) }
      return entry
    }
    case 'agent':
    case 'parent': {
      const data = node.data
      const reasoning = trimmedOrNull(data.reasoning)
      const promptSource = trimmedOrNull(data.systemPromptSource)
      const entry: CatalogRoleNodeEntry = {
        id: node.id,
        kind: node.kind,
        label: labelOf(node),
        presetId: trimmedOrNull(data.presetId),
        provider: textOf(data.provider),
        model: textOf(data.model),
        ...(reasoning ? { reasoning } : {}),
        inputSchema: textOf(data.inputSchema),
        outputSchema: textOf(data.outputSchema),
        ...(promptSource ? { systemPromptSource: promptSource } : {}),
        groupId: data.groupId ?? null,
      }
      return entry
    }
    case 'proxy': {
      const entry: CatalogProxyNodeEntry = {
        id: node.id,
        kind: 'proxy',
        label: textOf(node.data?.label) || node.proxySourceId,
        proxySourceId: node.proxySourceId,
        role: node.data?.role === 'milestone' ? 'milestone' : 'executor',
      }
      return entry
    }
    case 'group': {
      const entry: CatalogGroupNodeEntry = {
        id: node.id,
        kind: 'group',
        label: labelOf(node),
        collabPrompt: textOf(node.data.collabPrompt),
        memberIds: Array.isArray(node.data.memberIds) ? node.data.memberIds.map(textOf) : [],
      }
      return entry
    }
    case 'file': {
      const data = node.data
      const entry: CatalogFileNodeEntry = {
        id: node.id,
        kind: 'file',
        label: labelOf(node),
        fileKind: data.fileKind === 'file' ? 'file' : 'text',
        ...(data.content !== undefined ? { content: textOf(data.content) } : {}),
        ...(data.fileName !== undefined ? { fileName: textOf(data.fileName) } : {}),
        ...(data.managedPath !== undefined ? { managedPath: textOf(data.managedPath) } : {}),
        ...(Array.isArray(data.files)
          ? { files: data.files.map((file) => ({ fileName: textOf(file.fileName), managedPath: textOf(file.managedPath) })) }
          : {}),
      }
      return entry
    }
    case 'database': {
      const data = node.data
      const conn = maskConnection(data.conn)
      const entry: CatalogDatabaseNodeEntry = {
        id: node.id,
        kind: 'database',
        label: labelOf(node),
        description: textOf(data.description),
        dbType: data.dbType === 'server' ? 'server' : 'local',
        dbKind: textOf(data.dbKind),
        ...(data.localPath !== undefined ? { localPath: textOf(data.localPath) } : {}),
        ...(conn ? { conn } : {}),
        ...(trimmedOrNull(data.vectorSource) ? { vectorSource: textOf(data.vectorSource) } : {}),
        ...(data.vectorOptions ? { vectorOptions: data.vectorOptions as Record<string, unknown> } : {}),
      }
      return entry
    }
  }
}

/** 连线条目（条件分支语义是编排事实，必须给全）。 */
function lineEntryOf(line: Line): CatalogLineEntry {
  const condition = line.condition?.type
  return {
    id: line.id,
    source: line.source,
    target: line.target,
    sourceHandle: line.sourceHandle,
    targetHandle: line.targetHandle,
    ...(condition
      ? { condition: { type: condition, ...(line.condition?.label ? { label: line.condition.label } : {}) } }
      : {}),
  }
}
