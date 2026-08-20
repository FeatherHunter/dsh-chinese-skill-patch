import type { Context } from '@deepseek-ai/cordis';
/**
 * @dsh-external/dsh-chinese-skill-patch
 * 让 DSH 自动支持中文技能名（私家大厨 / 卡路里 / 作息管家 等）。
 *
 * 根因：DSH 三处硬编码只接受 kebab-case ascii:
 *   1. dsh-skill: SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
 *      - validateCandidate / validateRuntimeSkill / validateDefinition / SkillRegistry.get
 *   2. dsh-skill-filesystem: parseSkillFile -> isSkillName(name) -> warn skipped
 *   3. dsh-tool-skill: SKILL_GESTURE + skill tool isSkillName 检查
 *      - 输入框 /私 不能匹配，模型 skill({name:"私家大厨"}) 被拒
 *
 * 修复：
 *  - 运行时：直接改写 SkillRegistry 原型方法（get/register/listLayerCandidates）为 CN 版，
 *    并注册一个 CN 感知的 filesystem provider（chinese-skill-patch）来补齐中文发现；
 *    再加一个 agent/pre-step 对 CN_GESTURE 的注入，实现 /私家大厨 直达。
 *  - 持久化：把 agent/node_modules 下三文件的正则改成 CN 版，重启后即使不注入也生效。
 */
export declare const name = "dsh-chinese-skill-patch";
export declare const inject: readonly ["skills", "tools"];
export interface Config {
    allowPunycode?: boolean;
    /** 额外 agents 聚合目录（如 D:\3DeepSeekHarness\agents），用于把其子目录的 .dsh/skills 也纳入发现；不设则不扫描，避免硬编码 */
    extraAgentsDir?: string;
}
export declare const Config: any;
export declare function apply(ctx: Context, config: Config): void;
