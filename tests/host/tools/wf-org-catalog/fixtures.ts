// tests/host/tools/wf-org-catalog/fixtures.ts
//
// wf_org_catalog 单测共用工厂：角色模板条目、覆盖全部节点种类的工作流模板样本、宿主 fake。
// 只提供最小可复用样本，具体断言由各测试自持（不在这里预置期望值）。

import type { GraphNode, Line, WorkflowTemplate } from '../../../../src/host/shared/graph-model.js'
import type { OrgCatalogHost } from '../../../../src/host/tools/wf-org-catalog/tool.js'

/** 角色模板条目（工具只按字段读取，不依赖 RoleTemplate 类型）。 */
export function roleTemplateFixture(
  id = 'role-1',
  name = '分析员',
  systemPrompt = '你是分析员',
): Record<string, unknown> {
  return {
    id,
    kind: 'agent',
    name,
    systemPrompt,
    provider: 'deepseek',
    model: 'deepseek-chat',
    presetId: 'combo-1',
    reasoning: 'high',
    retryLimit: 3,
    systemPromptSource: '分析员.md',
  }
}

/** 覆盖全部节点种类与数据源字段的工作流模板样本（含内联协作组、闸门虚拟节点、服务器库）。 */
export function templateFixture(overrides: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  const nodes: GraphNode[] = [
    { id: 's', kind: 'start', position: { x: 0, y: 0 }, data: { label: '启动' } },
    {
      id: 'a1',
      kind: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: '分析员',
        systemPrompt: '你是分析员',
        provider: 'deepseek',
        model: 'deepseek-chat',
        presetId: 'combo-1',
        reasoning: 'high',
        retryLimit: 3,
        reactLimit: null,
        inputSchema: '上游结论',
        outputSchema: '分析报告路径',
        groupId: 'g1',
        systemPromptSource: '角色说明.md',
        injectSystemPrompt: false,
        injectToolSections: false,
      },
    },
    {
      id: 'g1',
      kind: 'group',
      position: { x: 0, y: 0 },
      data: { label: '评审组', collabPrompt: '组员互相评审', memberIds: ['a1'] },
    },
    {
      id: 'p1',
      kind: 'proxy',
      position: { x: 0, y: 0 },
      proxySourceId: 'a1',
      data: { label: '里程碑复核', role: 'milestone' },
    },
    { id: 'f1', kind: 'file', position: { x: 0, y: 0 }, data: { label: '基线说明', fileKind: 'text', content: '基线正文' } },
    {
      id: 'db1',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: { label: '本地库', description: '本地数据', dbType: 'local', dbKind: 'sqlite', localPath: 'D:/data.db' },
    },
    {
      id: 'db2',
      kind: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: '服务器库',
        description: '远端只读',
        dbType: 'server',
        dbKind: 'postgresql',
        conn: { host: 'db.internal', port: 5432, user: 'reader', password: 'secret', db: 'shop' },
      },
    },
    { id: 'pz', kind: 'pause', position: { x: 0, y: 0 }, data: { label: '暂停' } },
    { id: 'e', kind: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } },
  ]
  const lines: Line[] = [
    { id: 'l1', source: 's', target: 'a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    { id: 'l2', source: 'f1', target: 'a1', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' },
    { id: 'l3', source: 'a1', target: 'e', sourceHandle: 'flow-out', targetHandle: 'flow-in', condition: { type: 'fail' } },
    { id: 'l4', source: 'db1', target: 'db2', sourceHandle: 'db-out', targetHandle: 'db-in' },
  ]
  return {
    id: 'tpl-1',
    mode: 'mode1',
    name: '模板一',
    description: '模板描述',
    revision: 3,
    meta: { nodeMax: 12 },
    nodes,
    lines,
    ...overrides,
  }
}

/** 宿主 fake：记录角色清单读盘次数与模板读盘次数，供批内缓存断言。 */
export function makeCatalogHost(overrides: Partial<OrgCatalogHost> = {}): {
  host: OrgCatalogHost
  calls: { roleLists: number; templateReads: number }
} {
  const calls = { roleLists: 0, templateReads: 0 }
  const host: OrgCatalogHost = {
    store: {
      async listTemplates() {
        calls.roleLists += 1
        return [roleTemplateFixture()]
      },
      async listToolCombos() {
        return [{ id: 'combo-1', name: '分析组合', tools: ['read', 'write'], mcpServers: ['mcp-1'] }]
      },
      async listFlowTemplates() {
        return [templateFixture()]
      },
      async getFlowTemplate(id: string) {
        calls.templateReads += 1
        return id === 'tpl-1' ? templateFixture() : null
      },
    },
    listPresets: async () => [{ id: 'standard', name: '标准', description: '官方标准模式' }],
    listModels: async () => [{ provider: 'deepseek', model: 'deepseek-chat', efforts: [{ id: 'high', name: '高' }] }],
    ...overrides,
  }
  return { host, calls }
}
