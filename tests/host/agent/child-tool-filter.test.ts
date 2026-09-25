// tests/host/agent/child-tool-filter.test.ts
//
// 子代理工具白名单装配单测：
//   - 创建窗口夹持（withPending）：作用域内安装的 restrict 采用本次白名单；
//     空/缺省白名单不安装 restrict（与官方创建请求的「空 toolFilter」同语义）；
//   - 按 childId 留存与重发布重装（remember/restore）：冷恢复后白名单仍生效；
//   - 官方校验失败（名单含未注册工具）按尽力而为处理：不抛错、不阻断创建。

import { describe, expect, it, vi } from 'vitest'
import { createChildToolFilterSetup } from '../../../src/host/agent/child-tool-filter.js'

/** 最小 childCtx fake：经 get('tools') 取工具服务。 */
function ctxWithTools(restrict: (filter: { allow?: string[]; deny?: string[] }) => () => void): { get(name: string): unknown } {
  return { get: (name: string) => (name === 'tools' ? { restrict } : undefined) }
}

describe('createChildToolFilterSetup', () => {
  it('withPending：创建窗口内安装 allow 名单，并返回该次安装的撤销函数', async () => {
    const setup = createChildToolFilterSetup()
    const undo = vi.fn()
    const restrict = vi.fn(() => undo)
    const ctx = ctxWithTools(restrict as unknown as (filter: { allow?: string[]; deny?: string[] }) => () => void)

    const dispose = await setup.withPending(['read', 'write'], async () => setup.contribution(ctx))

    expect(restrict).toHaveBeenCalledWith({ allow: ['read', 'write'] })
    dispose()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('无创建窗口 / 空白名单：不调用 restrict（不限制继承面）', () => {
    const setup = createChildToolFilterSetup()
    const restrict = vi.fn()
    const ctx = ctxWithTools(restrict as unknown as (filter: { allow?: string[]; deny?: string[] }) => () => void)

    setup.contribution(ctx)
    expect(restrict).not.toHaveBeenCalled()

    expect(setup.restore('child-1', ctx)).toBeTypeOf('function')
    expect(restrict).not.toHaveBeenCalled()
  })

  it('restrict 抛错（名单含未注册工具）：不向上抛，退回继承面', async () => {
    const setup = createChildToolFilterSetup()
    const restrict = vi.fn(() => { throw new Error('tools.restrict() names unknown global tool "ghost"') })
    const ctx = ctxWithTools(restrict as unknown as (filter: { allow?: string[]; deny?: string[] }) => () => void)

    const dispose = await setup.withPending(['ghost'], async () => setup.contribution(ctx))
    expect(restrict).toHaveBeenCalledTimes(1)
    expect(() => dispose()).not.toThrow()
  })

  it('remember + restore：重发布（冷恢复）后按留存名单重装，并返回撤销函数', () => {
    const setup = createChildToolFilterSetup()
    const undo = vi.fn()
    const restrict = vi.fn(() => undo)
    const ctx = ctxWithTools(restrict as unknown as (filter: { allow?: string[]; deny?: string[] }) => () => void)

    setup.remember('child-1', ['read'])
    const dispose = setup.restore('child-1', ctx)

    expect(restrict).toHaveBeenCalledWith({ allow: ['read'] })
    dispose()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('remember 空名单：清除留存，restore 不再安装', () => {
    const setup = createChildToolFilterSetup()
    const restrict = vi.fn()
    const ctx = ctxWithTools(restrict as unknown as (filter: { allow?: string[]; deny?: string[] }) => () => void)

    setup.remember('child-1', ['read'])
    setup.remember('child-1', [])
    setup.restore('child-1', ctx)
    expect(restrict).not.toHaveBeenCalled()
  })
})
