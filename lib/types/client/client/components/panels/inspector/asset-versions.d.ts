import type { Dict } from '../../../i18n.js';
import type { StudioState } from '../../../studio/studio-state.js';
export interface AssetVersionsProps {
    copy: Dict;
    /** 已装载的版本列表（null = 尚未装载完成 → 显示加载中文案）。 */
    versions: StudioState['assetVersions'];
    /** 当前资产 id（版本数据必须与它同源，否则视为仍在装载）。 */
    assetId: string;
    onRollback(versionId: number): void;
    onClose(): void;
}
export declare function AssetVersions({ copy, versions, assetId, onRollback, onClose }: AssetVersionsProps): import("react").JSX.Element;
