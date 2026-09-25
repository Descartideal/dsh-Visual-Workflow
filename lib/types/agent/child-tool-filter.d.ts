/** 子代理工具白名单装配（贡献 + 创建窗口夹持 + 按 childId 留存）。 */
export interface ChildToolFilterSetup {
    /** 贡献（每子代理创建窗口内由宿主调用；读创建窗口内的白名单并安装 restrict）。 */
    contribution(childCtx: unknown): () => void;
    /**
     * 在创建窗口内夹住本次子代理的工具白名单。
     * 为什么需要：白名单无法经官方 Team 服务的创建请求传递，只能由本装配在窗口内取得。
     */
    withPending<T>(allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T>;
    /**
     * 按 childId 留存白名单，供重发布（冷恢复）时重装。
     * 为什么需要：子代理销毁重发布后是新作用域，创建窗口内安装的 restrict 随之消失。
     */
    remember(childId: string, allow: readonly string[] | undefined): void;
    /**
     * 重发布时按 childId 重装白名单；返回该次安装的撤销函数（无记录时返回空函数）。
     */
    restore(childId: string, childCtx: unknown): () => void;
}
/**
 * 创建子代理工具白名单装配。
 * WeakMap/ALS 之外只持有 childId → 名单的留存表；条目为工具名数组，随宿主持有的
 * 本装配对象一起回收（宿主 dispose 后无引用）。
 */
export declare function createChildToolFilterSetup(): ChildToolFilterSetup;
