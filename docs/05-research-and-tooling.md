# 调研与工程工具

调研日期：2026-10-26。以下只读核查官方资料或插件目录；没有安装、运行、基准测试或修改配置。官方页面说明能力不等于本项目已验证。实现前固定具体版本及许可证清单。

用户后续缩减范围：原音频变速与移调暂不考虑；Rubber Band 调研仅留作历史参考，不作为当前依赖或技术验证任务。Tauri 仅作为未来可能的迁移方向，本期不设计具体跨平台操作。

## 技术候选与证据

| 候选 | 本项目用途与限制 | 一手来源 |
|---|---|---|
| Tauri 2 | 网页界面与 Rust 桌面/移动容器；设备能力仍需平台验证 | https://v2.tauri.app/start/ ，https://v2.tauri.app/start/frontend/ |
| Web Audio / AudioWorklet | 本地调度与音频处理；UI 时钟不能代替音频时钟 | https://www.w3.org/TR/webaudio-1.0/ |
| Media Capture | 麦克风、安全上下文与降噪/回声约束；降噪并非通用多级参数 | https://www.w3.org/TR/mediacapture-streams/ |
| vLLM 多模态接口 | 现有服务若采用它，可通过适配器发送图像；不假定 远程 GPU 服务器 已使用它 | https://docs.vllm.ai/en/latest/features/multimodal_inputs/ |
| MusicXML 4.0 | 五线谱交换格式、歌词与音乐结构；不是项目数据库 | https://www.w3.org/2021/06/musicxml40/ |
| OpenSheetMusicDisplay | 从 MusicXML 显示五线谱；需自建编辑与 ID 点击映射，不是完整简谱编辑器 | https://github.com/opensheetmusicdisplay/opensheetmusicdisplay |
| 自建 SVG 简谱排版 | 对音符/字提供稳定命中区域；节拍布局、下划线、八度点和歌词排版需要专门实现 | 项目设计选择，非外部产品能力声明 |
| Audiveris | 可选传统 OMR 与 MusicXML 路径；官方资料不证明满足本项目简谱和重叠读取，不能替代 VLM 核心 | https://audiveris.github.io/audiveris/_pages/reference/outputs/README/ |
| YIN/MPM | 单音基频检测候选；评估 Rust 实现或移植并核验许可证与数值一致性 | https://github.com/sevagh/pitch-detection/blob/master/include/pitch_detection.h |
| RNNoise | 可选降噪，必须评估歌唱失真、延迟与平台支持 | https://github.com/xiph/rnnoise |
| Rubber Band | 独立速度与音高变换候选，采用前核验开源/商业许可与目标分发方式 | https://breakfastquay.com/rubberband/ |
| Playwright | 浏览器流程、项目矩阵、截图与失败回放；浏览器模拟不等于真机音频验收 | https://playwright.dev/docs/test-projects |

Rust Axum、SQLite、React、Vite、Vitest、cargo test 是工程建议，当前未逐一选定版本或实测。本轮不追求堆满框架；选型必须通过最小技术验证。

## Skills 与插件

- 已读取并用于本轮：plugin-management（目录发现）；OpenAI Docs（官方项目约定核查）。
- 插件目录查到 Superpowers，描述为规划、TDD、调试和协作的软件工程技能框架；官方仓库 https://github.com/obra/superpowers 。用户随后已安装 7.0.1，本会话已读取 using-superpowers、brainstorming、verification-before-completion 及 Codex 适配说明，用于继续设计讨论和文档核验；尚未执行其实现流程，不代表全部技能均已审阅或验证。
- GitHub 插件可用于未来仓库、Issue、PR 与 CI，目录确认当前未安装；本机文档阶段不需要连接远端仓库。
- 当前已有 computer-use 可辅助后期真浏览器交互；它不是音频数值或真实麦克风质量的测试替代品。
- 当前已有 sites 面向网站构建与托管；本项目明确自建目录、私有音频和自有 VLM，当前不采用其托管发布流程。
- skill-creator 可在实际流程稳定后创建“新增歌曲识谱评测”“音频回归”“项目交接”技能；现在优先维护小而明确的仓库文档，避免提前建立笨重流程。

## 推荐的 harness

这里的 harness 指让 agent 能复现任务、执行检查、保留证据和安全交接的一组约定与工具，而非一个自动保证软件正确的产品。

1. AGENTS.md：范围、数据保护、真实状态和必读入口。官方支持仓库级约定：https://learn.chatgpt.com/docs/agent-configuration/agents-md 。
2. 需求编号 -> 用例 -> 测试 -> 结果的关联；固定人工标注歌曲小样。
3. 本地默认假 VLM 返回夹具，真实 VLM 测试显式启用；回放固定输出测工程稳定性，独立实测模型准确率。
4. 核心 Rust 单元与属性测试；TS 组件测试；Playwright 用户流程；音频合成信号验证；少量真机检查。
5. 锁定依赖、Schema 与生成类型校验、格式与静态检查、许可证清单；有仓库后再接 CI。
6. 设计决定与交接日志：改变方案必须写原因、替代方案、影响与验证。未实测项保持待验证标记。

不建议第一天启用自主安装、自动部署或自动升级模型的 agent 流程。先让单个功能在固定样例上能重现，再扩展自动化。
