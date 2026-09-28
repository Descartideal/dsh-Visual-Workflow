/**
 * 内容指纹：先稳定序列化，再取 FNV-1a 64 位的 16 位十六进制。
 * 序列化规则：对象键升序、剔除值为 undefined 的键、数组保持顺序；
 * 因此「字段书写顺序不同」「可选字段缺席与显式 undefined」都得到同一指纹。
 */
export declare function contentFingerprint(value: unknown): string;
/** 稳定序列化（返回确定字符串；undefined 值在对象中剔除、在数组中落为 null）。 */
export declare function stableStringify(value: unknown): string;
