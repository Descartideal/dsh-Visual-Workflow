// src/client/components/panels/inspector/asset-versions.tsx
//
// 资产版本上拉列表（属性栏底部「回滚」按钮展开）：展示 Active 版本与历史版本，
// 点击某项即回滚 Active 指针到该版本（不新增版本、不改写历史版本内容）。
//
// 展示与交互层：版本数据来自状态机（state.assetVersions），本组件只投影与转发意图；
// 展开/收起属瞬时渲染态，留在组件本地（业务事实不因收起而丢失）。

import type { Dict } from '../../../i18n.js'
import type { StudioState } from '../../../studio/studio-state.js'

export interface AssetVersionsProps {
  copy: Dict
  /** 已装载的版本列表（null = 尚未装载完成 → 显示加载中文案）。 */
  versions: StudioState['assetVersions']
  /** 当前资产 id（版本数据必须与它同源，否则视为仍在装载）。 */
  assetId: string
  onRollback(versionId: number): void
  onClose(): void
}

/** 版本创建时间展示（epoch 毫秒 → 本地时间字符串）。 */
function createdAtText(createdAt: number): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export function AssetVersions({ copy, versions, assetId, onRollback, onClose }: AssetVersionsProps) {
  const items = versions && versions.assetId === assetId ? versions.items : null
  return (
    <>
      {/* 点击列表外部收起：透明遮罩承担「点外部关闭」，避免组件注册全局监听 */}
      <div className="wf-asset-versions__backdrop" onClick={onClose} />
      <div className="wf-asset-versions">
        <div className="wf-asset-versions__head">
          <span className="wf-asset-versions__title">{copy.assetVersionsTitle}</span>
          <button type="button" className="wf-btn wf-btn--xs" onClick={onClose}>{copy.assetVersionsClose}</button>
        </div>
        {items === null
          ? <div className="wf-asset-versions__hint">{copy.assetVersionsLoading}</div>
          : items.length === 0
            ? <div className="wf-asset-versions__hint">{copy.assetVersionsEmpty}</div>
            : (
                <div className="wf-asset-versions__list">
                  {items.map((item) => (
                    <button
                      key={item.rowId}
                      type="button"
                      className={`wf-asset-versions__item${item.active ? ' is-active' : ''}`}
                      onClick={() => onRollback(item.versionId)}
                    >
                      <span className="wf-asset-versions__version">{`v${item.versionId}`}</span>
                      <span className="wf-asset-versions__name">{item.name}</span>
                      <span className="wf-asset-versions__meta">
                        {`${(copy.assetVersionSource as Record<string, string>)[item.source] ?? item.source} · ${createdAtText(item.createdAt)}`}
                      </span>
                      {item.active ? <span className="wf-asset-versions__badge">{copy.assetVersionActive}</span> : null}
                    </button>
                  ))}
                </div>
              )}
      </div>
    </>
  )
}
