// tests/host/prompts/collab.test.ts
//
// T-005 协作成员清单块模板基线：始终含成员 ID+角色名，自定义说明追加式。

import { describe, expect, it } from 'vitest'
import { buildCollabBlock } from '../../../src/host/prompts/index.js'

describe('T-005 协作成员清单块模板（始终含成员 ID+角色名 + 自定义说明）', () => {
  const members = [
    { id: 'node-a', label: '分析节点' },
    { id: 'node-b', label: '总结节点' },
  ]

  it('无论 custom 是否为空，都默认列出组内全部成员的 ID 与角色名', () => {
    const block = buildCollabBlock({ members, custom: '' })
    for (const member of members) {
      expect(block).toContain(member.label)
      expect(block).toContain(member.id)
    }
  })

  it('custom 非空时追加到成员清单之后（追加式结构，以成员 id 为锚定位）', () => {
    const block = buildCollabBlock({ members, custom: '成员 A 与 B 互相质询' })
    expect(block).toContain('成员 A 与 B 互相质询')
    expect(block.indexOf(members[1].id)).toBeLessThan(block.indexOf('成员 A 与 B 互相质询'))
  })

  it('同一 params 两次构建字节相同', () => {
    expect(buildCollabBlock({ members, custom: '并行通信' })).toBe(buildCollabBlock({ members, custom: '并行通信' }))
  })

  it('official 通道：以成员名（target）寻址，并指示使用官方 send_message', () => {
    const withTargets = [
      { id: 'n-be-dev', label: '后端开发工程师', target: 'm-n-be-dev' },
      { id: 'n-be-rev', label: '后端代码审查专家', target: 'm-n-be-rev' },
    ]
    const block = buildCollabBlock({ members: withTargets, custom: '', channel: 'official' })
    for (const member of withTargets) {
      expect(block).toContain(member.label)
      expect(block).toContain(member.target)
    }
    expect(block).toContain('send_message')
    expect(block).not.toContain('wf_ask_agent')
    // 未标注成员名的条目回退按 id 展示（不出现空成员名）
    const fallback = buildCollabBlock({ members: [{ id: 'n-x', label: 'X' }], custom: '', channel: 'official' })
    expect(fallback).toContain('n-x')
  })

  it('缺省/legacy 通道：沿用插件自建协作工具文案（含成员 id）', () => {
    const block = buildCollabBlock({ members, custom: '' })
    expect(block).toContain('wf_ask_agent')
    for (const member of members) expect(block).toContain(member.id)
  })
})
