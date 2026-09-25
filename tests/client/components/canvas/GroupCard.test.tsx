// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/canvas/GroupCard.test.tsx
//
// 协作组卡片渲染（运行状态与高亮）：
//   - 组卡片自身状态徽标（状态点 + 词典文案）按快照状态渲染，无状态时不渲染；
//   - 运行中（running）加高亮类；联动高亮（highlighted）同样加高亮类；
//   - 成员迷你卡照常渲染成员名与成员状态点（状态事实来源不变）。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { GroupCard } from '../../../../src/client/components/canvas/GroupCard.js'
import { zh } from '../../../../src/client/i18n.js'
import { statusLabelOf } from '../../../../src/client/lib/status-label.js'
import type { CanvasNode } from '../../../../src/client/studio/studio-state.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = null
  container?.remove()
  container = null
})

const groupNode: CanvasNode = {
  id: 'n-g1',
  kind: 'group',
  position: { x: 0, y: 0 },
  data: { label: '后端开发组', collabPrompt: '组内并行', memberIds: ['n-dev', 'n-rev'], size: { w: 300, h: 220 } },
}

const members = [
  { id: 'n-dev', label: '后端开发工程师', status: 'running' },
  { id: 'n-rev', label: '后端代码审查专家', status: null },
]

function renderCard(overrides: Partial<React.ComponentProps<typeof GroupCard>> = {}): HTMLElement {
  const props: React.ComponentProps<typeof GroupCard> = {
    node: groupNode,
    copy: zh,
    members,
    selected: false,
    highlighted: false,
    runStatus: null,
    dropTarget: false,
    onPointerDown: () => {},
    onHandlePointerDown: () => {},
    onMemberSelect: () => {},
    onResizeStart: () => {},
    ...overrides,
  }
  act(() => {
    root = createRoot(container!)
    root.render(<GroupCard {...props} />)
  })
  return container!.querySelector('.wf-node') as HTMLElement
}

describe('GroupCard 运行状态与高亮', () => {
  it('running：组卡片渲染状态点与词典文案，并加运行中高亮类', () => {
    const card = renderCard({ runStatus: { status: 'running', attempts: 1 } })

    expect(card.className).toContain('is-running')
    const dot = card.querySelector('.wf-node__kind .wf-status-dot')
    expect(dot?.className).toContain('is-running')
    expect(card.querySelector('.wf-node__kind')?.textContent).toContain(statusLabelOf(zh, 'running'))
  })

  it('ok：渲染状态徽标但不加运行中高亮类', () => {
    const card = renderCard({ runStatus: { status: 'ok', attempts: 1 } })

    expect(card.className).not.toContain('is-running')
    expect(card.querySelector('.wf-node__kind .wf-status-dot')?.className).toContain('is-ok')
    expect(card.querySelector('.wf-node__kind')?.textContent).toContain(statusLabelOf(zh, 'ok'))
  })

  it('无运行状态：不渲染状态徽标（组卡片不伪造状态）', () => {
    const card = renderCard()

    expect(card.querySelector('.wf-node__kind .wf-status-dot')).toBeNull()
    expect(card.className).not.toContain('is-running')
  })

  it('联动高亮：加 is-highlighted 类（与角色节点同款语义）', () => {
    const card = renderCard({ highlighted: true })
    expect(card.className).toContain('is-highlighted')
  })

  it('成员迷你卡不受组状态影响：成员名与成员状态点照常渲染', () => {
    const card = renderCard({ runStatus: { status: 'running', attempts: 1 } })

    const memberCards = card.querySelectorAll('.wf-group__member')
    expect(memberCards).toHaveLength(2)
    expect(memberCards[0].textContent).toContain('后端开发工程师')
    expect(memberCards[1].textContent).toContain('后端代码审查专家')
    // 成员自身状态点（非组卡片徽标）按成员状态渲染
    expect(memberCards[0].querySelector('.wf-status-dot')?.className).toContain('is-running')
    expect(memberCards[1].querySelector('.wf-status-dot')).toBeNull()
  })
})
