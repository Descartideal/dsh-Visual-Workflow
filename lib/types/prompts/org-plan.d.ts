/**
 * 规划目标种类（三态；决定首段身份与改图语法的措辞）。
 * - create：按意图**新建**模板（规划期主用例）；
 * - template：在**既有模板**上继续规划；
 * - instance：为**既有工作流/服务实例**调整编排。
 */
export type OrgPlanTargetKind = 'create' | 'template' | 'instance';
/**
 * 规划变体关键约束短语（首段与末段双位；测试经本常量引用断言，不绑定具体文案）。
 */
export declare const ORG_PLAN_HARD_CONSTRAINTS: {
    /** D-11：规划不自动投产（工具无此护栏，只能写进提示词，故必须保留）。 */
    readonly templateOnly: "只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定";
    /** 主用例：新建模板（create 通路）。 */
    readonly createTemplate: "新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id";
    /** 次用例：改既有目标（必须带 targetId 与 expectRevision）。 */
    readonly updateTarget: "改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision";
    /**
     * 规则与资产来源：wf_org_catalog 是第一动作（规则全文 + 资产索引），其后才是工作区事实。
     * 为什么必须保留：规则不再随本提示词注入——不调工具就拿不到图语义（group / proxy /
     * 三通道连线等本插件自定义语义无法从训练数据推断），父代理会按通用直觉编排。
     */
    readonly surveyFirst: "先取规则再动手：不传 ids 调用 wf_org_catalog 拿到编排规则（图语义与设计方法）与现有资产（角色模板、组合、预设、工作流模板库），再勘察工作区事实（已有文件、技术栈、目录约定），最后才提交补丁";
    /**
     * 工具可被用户关闭（P1 决策：两工具由组合管理统一开关、默认开启）。
     * 为什么必须保留：工具被关闭时模型收到的是 UNKNOWN_TOOL，没有这句它就不知道
     * 「去组合管理开启后重试」，表现为父代理干脆不用工具。
     */
    readonly toolsMayBeClosed: "wf_org_catalog 与 wf_graph_patch 默认开启；任一工具不可用时，提示用户到组合管理开启后重试，不要改用其他方式改图";
};
/** 规划提示词入参：`facts` 为规划任务内字节稳定的静态事实，`dynamic` 仅注入末段。 */
export interface OrgPlanPromptParams {
    facts: {
        /** 规划目标种类（决定身份行与「新建 / 改既有」的语法指引）。 */
        target: OrgPlanTargetKind;
        /** 既有目标 id（target 为 template/instance 时必填；create 时可省略，亦可给建议 id）。 */
        targetId?: string;
        /** 目标人类可读名称（create 时为「拟用名称」；缺省回退为 id 或「新工作流模板」）。 */
        targetName?: string;
        /** 系统语言名（如 '中文'；缺省不注入语言规则）。 */
        systemLanguage?: string;
    };
    dynamic: {
        /** 用户本次规划意图（不稳定内容，仅末段注入）。 */
        userIntent: string;
        /**
         * L3 用户 SOP 注入点（D-19）。
         * TODO(可视化可调项)：目前无任何调用方传入（`/arrange` 只传 userIntent），
         * 待「组织规划提示词可调项」UI 落地后由 arrange 命令注入。
         */
        userSop?: string;
        /** 「本次组织预算」文本（buildOrgBudgetText 输出；仅末段注入）。 */
        orgBudgetText?: string;
    };
}
/**
 * 规则来源段：编排规则（图语义与设计方法）不再随本提示词注入，改由工具按需返回。
 *
 * 为什么换注入点：规则文本的单一事实源在提示词常量层，但规划期与运行期都需要它——
 * 由 wf_org_catalog 返回既覆盖两个阶段，又不与工具返回重复占用上下文（用户裁决）。
 */
export declare const ORG_RULES_SOURCE_NOTE = "\u7F16\u6392\u89C4\u5219\uFF08\u56FE\u8BED\u4E49\u4E0E\u8BBE\u8BA1\u65B9\u6CD5\uFF09\u7531 wf_org_catalog \u63D0\u4F9B\uFF1A\u4E0D\u4F20 ids \u8C03\u7528\u5B83\u5373\u53EF\u83B7\u5F97\u89C4\u5219\u5168\u6587\u4E0E\u8D44\u4EA7\u7D22\u5F15\uFF0C\u52A8\u7B14\u524D\u5148\u53D6\u3002";
/**
 * 构建规划期父代理提示词（纯函数）。
 * @param params facts（目标种类/身份/语言）+ dynamic（用户意图/L3 SOP/预算文本）
 * @returns 完整提示词文本：HEAD 硬约束 → MID（L1 + 设计方法）→ TAIL（重申 + 自检 + 动态状态）
 */
export declare function buildOrgPlanPrompt(params: OrgPlanPromptParams): string;
