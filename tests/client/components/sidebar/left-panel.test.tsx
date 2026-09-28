// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/sidebar/left-panel.test.tsx
//
// 左侧库改造（模版 / 资产来源 + 搜索栏）：
//   ① 搜索栏常驻四个 Tag 之下、列表之上；输入经 onSetLibSearch 上报（受控）；
//   ② 左栏底部「模版 / 资产」切换标签：渲染、选中态（is-active / aria-selected）、点击上报；
//   ③ 资产态数据 Tab 与搜索无结果走词典空态文案（不硬编码）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { LeftPanel, type LeftPanelProps } from '../../../../src/client/components/sidebar/LeftPanel.js'
import { zh } from '../../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
})

/** 左栏 props 工厂（只覆盖被测字段，其余为最小缺省）。 */
function makeProps(partial: Partial<LeftPanelProps> = {}): LeftPanelProps {
  return {
    copy: zh,
    libTab: 'workflow',
    onSetTab: () => {},
    librarySource: 'template',
    onSetLibrarySource: () => {},
    libSearch: '',
    onSetLibSearch: () => {},
    open: true,
    width: 230,
    mode: 'mode1',
    workflows: [],
    currentSessionId: 's-1',
    flowTemplates: [],
    assets: { workflows: [], roles: [] },
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
    onSelectFlowAsset: () => {},
    onOpenRoleAsset: () => {},
    onPlaceRoleAsset: () => {},
    onSelectLib: () => {},
    onPlaceTemplate: () => {},
    onPlaceTemplateIntoGroup: () => {},
    onPlaceStage: () => {},
    onPlaceGroup: () => {},
    onPlaceGroupFromTemplate: () => {},
    onPlaceParent: () => {},
    onCreateNew: () => {},
    onBeginDrag: () => {},
    ...partial,
  }
}

async function renderPanel(props: LeftPanelProps): Promise<void> {
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(LeftPanel, props))
  })
}

function searchInput(): HTMLInputElement {
  return document.querySelector('.wf-lib-search__input') as HTMLInputElement
}

/** 受控输入赋值（绕过 React 的 value tracker，使 input 事件被判定为「有变化」）。 */
function typeInto(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function sourceTabs(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.wf-lib-source__tab'))
}

describe('左栏搜索栏（常驻两态）', () => {
  it('渲染在四个 Tag 之下、列表之上；受控值来自 props', async () => {
    await renderPanel(makeProps({ libSearch: '关键词' }))
    const input = searchInput()
    expect(input).toBeTruthy()
    expect(input.value).toBe('关键词')
    expect(input.getAttribute('placeholder')).toBe(zh.libSearchPlaceholder)
    const rail = document.querySelector('.wf-docrail')!
    const order = Array.from(rail.children).map((child) => child.className)
    expect(order.indexOf('wf-lib-tabs')).toBeLessThan(order.indexOf('wf-lib-search'))
    expect(order.indexOf('wf-lib-search')).toBeLessThan(order.indexOf('wf-docrail__list'))
  })

  it('输入上报关键词（不自行持有状态）', async () => {
    const onSetLibSearch = vi.fn()
    await renderPanel(makeProps({ onSetLibSearch }))
    await act(async () => {
      typeInto(searchInput(), 'abc')
    })
    expect(onSetLibSearch).toHaveBeenCalledWith('abc')
  })
})

describe('左栏底部「模版 / 资产」切换', () => {
  it('两个标签渲染在列表之后（左栏底部），文案取自词典', async () => {
    await renderPanel(makeProps())
    const rail = document.querySelector('.wf-docrail')!
    const order = Array.from(rail.children).map((child) => child.className)
    expect(order.indexOf('wf-docrail__list')).toBeLessThan(order.indexOf('wf-lib-source'))
    expect(sourceTabs().map((tab) => tab.textContent)).toEqual([zh.libSourceTemplate, zh.libSourceAsset])
  })

  it('模版态：模版标签选中（is-active + aria-selected）', async () => {
    await renderPanel(makeProps({ librarySource: 'template' }))
    const [templateTab, assetTab] = sourceTabs()
    expect(templateTab.classList.contains('is-active')).toBe(true)
    expect(templateTab.getAttribute('aria-selected')).toBe('true')
    expect(assetTab.classList.contains('is-active')).toBe(false)
    expect(assetTab.getAttribute('aria-selected')).toBe('false')
  })

  it('资产态：资产标签选中', async () => {
    await renderPanel(makeProps({ librarySource: 'asset' }))
    const [templateTab, assetTab] = sourceTabs()
    expect(assetTab.classList.contains('is-active')).toBe(true)
    expect(templateTab.classList.contains('is-active')).toBe(false)
  })

  it('点击标签上报目标来源', async () => {
    const onSetLibrarySource = vi.fn()
    await renderPanel(makeProps({ onSetLibrarySource }))
    await act(async () => { sourceTabs()[1].click() })
    expect(onSetLibrarySource).toHaveBeenCalledWith('asset')
    await act(async () => { sourceTabs()[0].click() })
    expect(onSetLibrarySource).toHaveBeenLastCalledWith('template')
  })
})

describe('资产态与搜索空态（词典文案）', () => {
  it('资产态数据 Tab：整页空态提示「该分类暂无资产」（非中文硬编码）', async () => {
    await renderPanel(makeProps({ librarySource: 'asset', libTab: 'data' }))
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.assetListNotSupported)
    expect(document.querySelectorAll('.wf-docgroup')).toHaveLength(0)
  })

  it('搜索无结果：整页空态提示，且不渲染任何分区标题', async () => {
    await renderPanel(makeProps({ libSearch: '无命中', workflows: [{ id: 'flow-1', name: '甲方' }] }))
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.searchNoResult)
    expect(document.querySelectorAll('.wf-docgroup')).toHaveLength(0)
  })

  it('资产态工作流 Tab 为空：分区空态为「资产只能由模版入库晋升」', async () => {
    await renderPanel(makeProps({ librarySource: 'asset', libTab: 'workflow' }))
    expect(document.querySelector('.wf-docgroup')?.textContent).toContain(zh.assetWorkflows)
    expect(document.querySelector('.wf-hint')?.textContent).toBe(zh.assetEmptyHint)
  })
})

describe('资产卡片交互（左栏）', () => {
  it('工作流资产卡片：pointerdown 挂载拖拽 payload（label = 资产名）', async () => {
    const onBeginDrag = vi.fn()
    await renderPanel(makeProps({
      librarySource: 'asset',
      libTab: 'workflow',
      assets: { workflows: [{ assetId: 'a-1', versionId: 1, name: '资产一', description: '', updatedAt: 1 }], roles: [] },
      onBeginDrag,
    }))
    const card = document.querySelector('.wf-docitem') as HTMLButtonElement
    expect(card.textContent).toContain('资产一')
    await act(async () => {
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5, button: 0 }))
    })
    expect(onBeginDrag).toHaveBeenCalledTimes(1)
    expect((onBeginDrag.mock.calls[0]![1] as { label: string }).label).toBe('资产一')
  })
})
