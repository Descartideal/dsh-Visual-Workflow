// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// tests/client/components/panels/inspector/asset-versions.test.tsx
//
// AssetVersions（资产版本上拉列表）单测：
//   ① 版本条目渲染（版本号 / 名称 / 来源 / 时间）与 Active 打标；
//   ② 点击条目 → 回滚该版本（不弹二次确认、不新增版本）；
//   ③ 装载中 / 空列表 / 数据不同源 → 词典文案；点遮罩或「关闭」收起。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { AssetVersions } from '../../../../../src/client/components/panels/inspector/asset-versions.js'
import { zh } from '../../../../../src/client/i18n.js'

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  root = null
  container?.remove()
  container = null
})

const ITEMS = [
  { versionId: 2, rowId: 'a-1@2', name: '第二版', createdAt: 1700000000000, source: 'human' as const, active: true },
  { versionId: 1, rowId: 'a-1@1', name: '第一版', createdAt: 1690000000000, source: 'agent' as const, active: false },
]

async function render(element: React.ReactElement): Promise<void> {
  if (root) {
    act(() => { root!.unmount() })
    root = null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(element)
  })
}

/** 渲染上拉列表（缺省：装载完成的两个版本）。 */
async function renderVersions(overrides: Partial<React.ComponentProps<typeof AssetVersions>> = {}): Promise<{
  onRollback: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}> {
  const onRollback = vi.fn()
  const onClose = vi.fn()
  await render(React.createElement(AssetVersions, {
    copy: zh,
    versions: { kind: 'workflow', assetId: 'a-1', items: ITEMS },
    assetId: 'a-1',
    onRollback,
    onClose,
    ...overrides,
  }))
  return { onRollback, onClose }
}

describe('资产版本上拉列表（AssetVersions）', () => {
  it('渲染版本号 / 名称 / 来源，当前 Active 版本打标', async () => {
    await renderVersions()

    const items = Array.from(container!.querySelectorAll('.wf-asset-versions__item'))
    expect(items).toHaveLength(2)
    expect(items[0]!.querySelector('.wf-asset-versions__version')?.textContent).toBe('v2')
    expect(items[0]!.querySelector('.wf-asset-versions__name')?.textContent).toBe('第二版')
    expect(items[0]!.querySelector('.wf-asset-versions__meta')?.textContent)
      .toContain(zh.assetVersionSource.human)
    expect(items[1]!.querySelector('.wf-asset-versions__meta')?.textContent)
      .toContain(zh.assetVersionSource.agent)
    // Active 打标只出现在当前版本上（is-active 状态类 + 徽标文案）
    expect(items[0]!.className).toContain('is-active')
    expect(items[0]!.querySelector('.wf-asset-versions__badge')?.textContent).toBe(zh.assetVersionActive)
    expect(items[1]!.className).not.toContain('is-active')
    expect(items[1]!.querySelector('.wf-asset-versions__badge')).toBeNull()
  })

  it('点击版本条目 → 请求回滚该版本（不新增版本、无二次确认弹层）', async () => {
    const { onRollback } = await renderVersions()

    const items = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-asset-versions__item'))
    act(() => { items[1]!.click() })

    expect(onRollback).toHaveBeenCalledWith(1)
    // 回滚不弹确认层：组件自身不渲染任何确认/弹窗元素
    expect(container!.querySelector('.wf-confirm')).toBeNull()
  })

  it('版本数据尚未装载（null 或与当前资产不同源）→ 显示加载中文案', async () => {
    await renderVersions({ versions: null })
    expect(container!.querySelector('.wf-asset-versions__hint')?.textContent).toBe(zh.assetVersionsLoading)

    await renderVersions({ versions: { kind: 'workflow', assetId: 'a-other', items: ITEMS } })
    expect(container!.querySelector('.wf-asset-versions__hint')?.textContent).toBe(zh.assetVersionsLoading)
  })

  it('版本列表为空 → 显示空态文案', async () => {
    await renderVersions({ versions: { kind: 'workflow', assetId: 'a-1', items: [] } })
    expect(container!.querySelector('.wf-asset-versions__hint')?.textContent).toBe(zh.assetVersionsEmpty)
    expect(container!.querySelectorAll('.wf-asset-versions__item')).toHaveLength(0)
  })

  it('点遮罩或「关闭」→ 收起（onClose）', async () => {
    const first = await renderVersions()
    act(() => { container!.querySelector<HTMLElement>('.wf-asset-versions__backdrop')!.click() })
    expect(first.onClose).toHaveBeenCalledTimes(1)

    const second = await renderVersions()
    const close = Array.from(container!.querySelectorAll<HTMLButtonElement>('.wf-asset-versions button'))
      .find((item) => item.textContent === zh.assetVersionsClose)
    act(() => { close!.click() })
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })
})
