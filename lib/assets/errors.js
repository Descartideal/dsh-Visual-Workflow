// src/host/assets/errors.ts
//
// 资产库的稳定错误类型：code 只取共享协议常量（禁止在调用点硬编码字面量），
// message 面向可行动性——说明发生了什么、哪个资产/版本、如何恢复。
import { ERR_ASSET_BAD_ARGS, ERR_ASSET_DUPLICATE, ERR_ASSET_NOT_FOUND, ERR_ASSET_VERSION_NOT_FOUND, } from '../shared/protocol.js';
/**
 * 资产库错误：API 边界按 code 翻译 HTTP 状态（404 / 409 / 400），
 * 因此 code 属对外契约，取值只能来自 shared/protocol。
 */
export class AssetError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'AssetError';
        this.code = code;
    }
}
/** 资产不存在或已退役（Active 索引无对应行）。 */
export function assetNotFound(assetId) {
    return new AssetError(`资产 ${assetId} 不存在或已退役：请刷新资产列表后重试`, ERR_ASSET_NOT_FOUND);
}
/** 目标版本行不存在（回滚目标版本号非法）。 */
export function assetVersionNotFound(assetId, versionId) {
    return new AssetError(`资产 ${assetId} 的版本 v${versionId} 不存在：请从版本列表中选择有效版本`, ERR_ASSET_VERSION_NOT_FOUND);
}
/** 入参形状非法（缺失必填字段 / 类型不符）。 */
export function assetBadArgs(message) {
    return new AssetError(message, ERR_ASSET_BAD_ARGS);
}
//# sourceMappingURL=errors.js.map