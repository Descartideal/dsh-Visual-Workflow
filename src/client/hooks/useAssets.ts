// src/client/hooks/useAssets.ts
//
// 资产面（模版晋升而来的可复用资料）：列表加载 / 详情装载 / 入库晋升 /
// 登记新版本 / 版本列表 / 回滚 / 退役。
//
// 语义边界（用户裁决）：模版 = 可随意修改的草稿；资产 = 带版本控制与回滚，
// 版本历史永不被改写（回滚只改 Active 指针）。
//
// 职责边界：本 hook 只做「远端调用 + 状态写入 + 失败语义 + toast」；
// 资产态的画布投影与文档生命周期在 studio 状态机与 useDocumentActions 中完成。
//
// 失败语义（client AGENTS「数据流与数据访问边界」）：稳定错误码按语义分支——
// ERR_ASSET_DUPLICATE（重复入库）提示「重复入库已取消」并保留原列表；
// ERR_ASSET_NOT_FOUND（资产不存在/已退役）提示并刷新资产列表。
// 异步防竞态：列表与详情加载各持一份请求序号，只有最新一次请求可写状态；
// 卸载后一律不写。

import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type {
  AssetDetail, AssetKind, AssetVersionEntry, RoleAssetDetail, RoleAssetType, WorkflowAssetDetail,
} from '../../host/shared/asset-types.js'
import type { StudioAction, StudioState } from '../studio/studio-state.js'
import type { RemoteFace } from './useRemote.js'
import type { RemoteError } from '../lib/remote.js'
import type { ToastFace } from './useToast.js'
import type { Dict } from '../i18n.js'
import { EP } from '../lib/remote.js'

/** 入库 / 登记新版本的返回面（后端 promoteAsset / saveAssetVersion 契约）。 */
export interface AssetPromoteResult {
  assetId: string
  versionId: number
  rowId: string
  /** true = 内容与当前 Active 版本全等，未新增版本（去重命中）。 */
  unchanged: boolean
  /** 角色资产的种类（角色入库返回）。 */
  roleAssetType?: RoleAssetType
  /** 因本次入库被判定为共享的角色资产 id 列表。 */
  sharedRoleAssetIds?: string[]
}

export interface AssetsFace {
  assets: StudioState['assets']
  assetDoc: StudioState['assetDoc']
  assetVersions: StudioState['assetVersions']
  /** 重新加载资产列表（Active 版本索引）。 */
  refresh(): Promise<void>
  /** 取单个资产详情（按 kind 装载对应状态槽；失败返回 null）。 */
  loadAsset(kind: AssetKind, assetId: string): Promise<AssetDetail | null>
  /** 模版 → 资产入库（同一模版再次入库 = 同一资产的新版本）。 */
  promote(kind: AssetKind, templateId: string): Promise<AssetPromoteResult | null>
  /** 资产态保存：登记该资产的新版本。 */
  saveVersion(kind: AssetKind, assetId: string, payload: unknown): Promise<AssetPromoteResult | null>
  /** 打开版本上拉列表数据（回滚选择）。 */
  openVersions(kind: AssetKind, assetId: string): Promise<void>
  /** 关闭版本上拉列表数据。 */
  closeVersions(): void
  /**
   * 回滚 Active 指针到历史版本（不改写历史版本内容）。
   * @returns 是否成功（失败时调用方保留现场：不收起版本列表、不清理界面残留）。
   */
  rollback(kind: AssetKind, assetId: string, versionId: number): Promise<boolean>
  /**
   * 退役资产（Active 移除、历史版本保留）。
   * @returns 是否成功（语义同 rollback）。
   */
  retire(kind: AssetKind, assetId: string): Promise<boolean>
  /** 打开工作流资产文档：装载详情后把画布切到该资产（资产态画布文档）。 */
  openFlowAsset(assetId: string): Promise<void>
  /** 打开角色资产：装载详情后在属性栏编辑。 */
  openRoleAsset(assetId: string): Promise<void>
}

/** 资产列表响应归一化（形状漂移一律降级为空列表，不因未知字段抛错）。 */
function normalizeList(payload: unknown): StudioState['assets'] {
  const record = (payload ?? {}) as { workflows?: unknown; roles?: unknown }
  return {
    workflows: Array.isArray(record.workflows) ? record.workflows : [],
    roles: Array.isArray(record.roles) ? record.roles : [],
  }
}

/** 远端错误的稳定码（无码 = 传输/解析失败）。 */
function codeOf(error: unknown): string {
  return String((error as RemoteError | null | undefined)?.code ?? '')
}

/** 资产面（远端失败已就地翻译为提示；返回值 null 表示本次调用未产生结果）。 */
export function useAssets(
  remote: RemoteFace,
  dispatch: Dispatch<StudioAction>,
  notify: ToastFace['toast'],
  toastError: ToastFace['toastError'],
  t: Dict,
  state: StudioState,
): AssetsFace {
  /** 卸载守卫：卸载后不再写状态。 */
  const mounted = useRef(true)
  /** 列表请求序号（只有最新一次刷新可写状态）。 */
  const listSeq = useRef(0)
  /** 详情请求序号（切换资产后迟到的装载不得覆盖当前资产）。 */
  const detailSeq = useRef(0)
  /** 版本列表请求序号（与详情装载各自独立，互不取消）。 */
  const versionsSeq = useRef(0)
  useEffect(() => () => {
    mounted.current = false
  }, [])
  /** 状态引用：回调闭包读最新状态（回滚后是否重投影画布等归属判定）。 */
  const stateRef = useRef(state)
  stateRef.current = state

  /** 资产失败统一翻译（稳定码优先）；返回 true = 已按资产语义处理（调用方不再提示）。 */
  const handleAssetFailure = useCallback(async (error: unknown, reload: boolean): Promise<boolean> => {
    const code = codeOf(error)
    if (code === EP.ERR_ASSET_DUPLICATE) {
      // 重复入库 = 内容与 Active 版本全等：不是错误，取消本次入库并保留原列表
      notify('info', t.assetDuplicateCancelled)
      return true
    }
    if (code === EP.ERR_ASSET_NOT_FOUND || code === EP.ERR_ASSET_VERSION_NOT_FOUND) {
      notify('error', t.assetNotFound)
      if (reload) {
        const seq = ++listSeq.current
        try {
          const payload = await remote.call(EP.EP_LIST_ASSETS, {})
          if (!mounted.current || seq !== listSeq.current) return true
          dispatch({ type: 'ASSETS_LOADED', ...normalizeList(payload) })
        } catch {
          // 刷新失败不再叠加提示（首条提示已说明资产不存在）
        }
      }
      return true
    }
    return false
  }, [dispatch, notify, remote, t.assetDuplicateCancelled, t.assetNotFound])

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++listSeq.current
    try {
      const payload = await remote.call(EP.EP_LIST_ASSETS, {})
      // 归属校验：只有最新一次刷新可写（旧的迟到响应丢弃）；卸载后不写
      if (!mounted.current || seq !== listSeq.current) return
      dispatch({ type: 'ASSETS_LOADED', ...normalizeList(payload) })
    } catch (error) {
      if (!mounted.current || seq !== listSeq.current) return
      if (await handleAssetFailure(error, false)) return
      toastError(error)
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  const loadAsset = useCallback(async (kind: AssetKind, assetId: string): Promise<AssetDetail | null> => {
    const seq = ++detailSeq.current
    try {
      const detail = await remote.call(EP.EP_GET_ASSET, { kind, assetId }) as AssetDetail | null
      if (!detail) return null
      if (!mounted.current || seq !== detailSeq.current) return null
      if (kind === 'role') dispatch({ type: 'ROLE_ASSET_LOADED', detail: detail as RoleAssetDetail })
      else dispatch({ type: 'ASSET_DOC_LOADED', detail: detail as WorkflowAssetDetail })
      return detail
    } catch (error) {
      if (!mounted.current) return null
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  /**
   * 入库 / 登记新版本共用后处理：成功刷新列表并提示。
   * 提示必须让用户知道「写的是哪个资产、写成了哪一版」，因此把 assetId / versionId 代入词条模板；
   * 后端幂等短路（unchanged）时改用「内容未变化，未新增版本」，避免给出「已入库」的错误暗示。
   */
  const afterWrite = useCallback(async (result: AssetPromoteResult | null, successText: string): Promise<AssetPromoteResult | null> => {
    if (!result) return null
    if (!mounted.current) return result
    if (result.unchanged) {
      notify('info', t.assetPromoteUnchanged)
    } else {
      notify('success', successText.replace('{id}', result.assetId).replace('{version}', String(result.versionId)))
    }
    await refresh()
    return result
  }, [notify, refresh, t.assetPromoteUnchanged])

  const promote = useCallback(async (kind: AssetKind, templateId: string): Promise<AssetPromoteResult | null> => {
    try {
      const result = await remote.call(EP.EP_PROMOTE_ASSET, { kind, templateId }) as AssetPromoteResult | null
      return await afterWrite(result, t.toastAssetPromoted)
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [afterWrite, handleAssetFailure, remote, t.toastAssetPromoted, toastError])

  const saveVersion = useCallback(async (kind: AssetKind, assetId: string, payload: unknown): Promise<AssetPromoteResult | null> => {
    try {
      const result = await remote.call(EP.EP_SAVE_ASSET_VERSION, { kind, assetId, payload }) as AssetPromoteResult | null
      return await afterWrite(result, t.toastAssetVersionSaved)
    } catch (error) {
      if (await handleAssetFailure(error, true)) return null
      toastError(error)
      return null
    }
  }, [afterWrite, handleAssetFailure, remote, t.toastAssetVersionSaved, toastError])

  const openVersions = useCallback(async (kind: AssetKind, assetId: string): Promise<void> => {
    const seq = ++versionsSeq.current
    try {
      const items = await remote.call(EP.EP_LIST_ASSET_VERSIONS, { kind, assetId }) as AssetVersionEntry[] | null
      if (!mounted.current || seq !== versionsSeq.current) return
      dispatch({ type: 'ASSET_VERSIONS_LOADED', kind, assetId, items: Array.isArray(items) ? items : [] })
    } catch (error) {
      if (!mounted.current) return
      if (await handleAssetFailure(error, true)) return
      toastError(error)
    }
  }, [dispatch, handleAssetFailure, remote, toastError])

  const closeVersions = useCallback((): void => {
    dispatch({ type: 'ASSET_VERSIONS_CLOSED' })
  }, [dispatch])

  /**
   * 回滚到指定版本：只改 Active 指针（不新增版本）。
   * 返回值 = 是否成功：调用方据此决定要不要收起版本列表/刷新界面（失败时保留现场，避免误判已生效）。
   */
  const rollback = useCallback(async (kind: AssetKind, assetId: string, versionId: number): Promise<boolean> => {
    try {
      await remote.call(EP.EP_ROLLBACK_ASSET, { kind, assetId, versionId })
      if (!mounted.current) return true
      notify('success', t.toastAssetRolledBack)
      // 重新装载 Active 详情；若该工作流资产正开在画布上，同步重投影画布
      await loadAsset(kind, assetId)
      if (!mounted.current) return true
      const current = stateRef.current
      if (kind === 'workflow' && current.currentKind === 'flowAsset' && current.currentId === assetId) {
        dispatch({ type: 'OPEN_FLOW_ASSET', assetId })
      }
      await refresh()
      return true
    } catch (error) {
      if (await handleAssetFailure(error, true)) return false
      toastError(error)
      return false
    }
  }, [dispatch, handleAssetFailure, loadAsset, notify, refresh, remote, t.toastAssetRolledBack, toastError])

  /** 退役资产（Active 移除、历史保留）；返回值 = 是否成功，语义同 rollback。 */
  const retire = useCallback(async (kind: AssetKind, assetId: string): Promise<boolean> => {
    try {
      await remote.call(EP.EP_RETIRE_ASSET, { kind, assetId })
      if (!mounted.current) return true
      notify('success', t.toastAssetRetired)
      await refresh()
      return true
    } catch (error) {
      if (await handleAssetFailure(error, true)) return false
      toastError(error)
      return false
    }
  }, [handleAssetFailure, notify, refresh, remote, t.toastAssetRetired, toastError])

  const openFlowAsset = useCallback(async (assetId: string): Promise<void> => {
    const detail = await loadAsset('workflow', assetId) as WorkflowAssetDetail | null
    if (!detail || !mounted.current) return
    dispatch({ type: 'OPEN_FLOW_ASSET', assetId })
  }, [dispatch, loadAsset])

  const openRoleAsset = useCallback(async (assetId: string): Promise<void> => {
    const detail = await loadAsset('role', assetId) as RoleAssetDetail | null
    if (!detail || !mounted.current) return
    dispatch({ type: 'OPEN_ROLE_ASSET', assetId })
  }, [dispatch, loadAsset])

  return {
    assets: state.assets,
    assetDoc: state.assetDoc,
    assetVersions: state.assetVersions,
    refresh, loadAsset, promote, saveVersion, openVersions, closeVersions, rollback, retire,
    openFlowAsset, openRoleAsset,
  }
}
