import type { Context } from '@deepseek-ai/cordis';
/**
 * @dsh-external/dsh-chinese-skill-patch
 * 让 DSH 自动支持中文技能名（私家大厨 / 卡路里 / 作息管家 等）。
 *
 * 原理：DSH 的 `SkillRegistry` 仅校验所有 skill provider（含 filesystem）是否
 * 满足 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。plugin 复用 `dsh-skill-filesystem` 的
 * 扫描逻辑，但以 `^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u` 替换校验，自身以
 * `rank: 90` 注册（比 project-dsh 100 更优先），保留"近层遮远层"特性。
 * 不修改 DSH 源码、不改你已装在 `D:\3DeepSeekHarness\agents\*.dsh\skills\`
 * 下的 SKILL.md 任何字符；卸载插件后回退到 `kebab-case` 严格校验。
 *
 * 工具型式：toolkit（无 UI/无 daemon），由 plugin apply 一次性注册。
 */
export declare const name = "@dsh-external/dsh-chinese-skill-patch";
export declare const inject: readonly ["skills"];
export interface Config {
    /** 自定义中文校验正则，默认放行 Unicode 字母+数字+中划线 */
    allowPunycode?: boolean;
}
export declare const Config: any;
export declare function apply(ctx: Context, config: Config): void;
