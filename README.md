# 声笺 · Music Practice Workbench

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Rust](https://img.shields.io/badge/backend-Rust%20%2B%20Axum%20%2B%20SQLite-dea584)](#技术栈)
[![React](https://img.shields.io/badge/frontend-React%2019%20%2B%20TypeScript-61dafb)](#技术栈)

本地优先的个人音乐练习工作台：整理歌曲曲库，查看简谱与五线谱，跟随谱面进行变速、移调的钢琴播放，用麦克风实时监听演唱音高，并管理歌词、愿望单与练习素材。

服务端为 Rust（Axum + SQLite），前端为 React + TypeScript，音频全部由浏览器 Web Audio 在本地完成。服务只监听 `127.0.0.1`，歌曲、谱面、录音等数据全部保存在本机，不上传任何云端。

> 当前面向 Windows（提供 PowerShell 脚本），保留后续跨平台迁移的结构。

## 功能特性

- **曲库与歌曲管理** — 歌曲资料、平台链接、标签、归档、回收站与批量管理；支持从 QQ 音乐 / 网易云音乐链接一键抓取歌曲资料与封面
- **按谱播放** — 简谱 / 五线谱渲染，钢琴音色按谱播放，支持变速、移调与八度调整；导入的原始音频保持原速原调，不受影响
- **实时音高监听** — 麦克风音高曲线与参考音高对照，支持唱名（do re mi）与半音网格显示，音高图可拖动、缩放、调整显示位置
- **双行歌词** — 同一音符可挂接两行歌词（如两段唱词），播放时随谱面同步高亮
- **外部转谱导入** — 内置 [shengjian.score v1](docs/formats/shengjian-score-v1.schema.json) JSON 格式与一键复制的转谱提示词，可交由任意外部 AI 工具生成转谱后导入；先审核、再应用
- **愿望单** — 只填歌名即可登记想练的歌，之后逐步补全资料与素材
- **实验性识谱** — 可配置 OpenAI 兼容的视觉模型 API，从曲谱图片识别音符；**准确度尚未通过验收，识别结果必须人工校对**（见 [识谱与导入](docs/08-recognition-and-external-import.md)）

## 技术栈

| 层 | 技术 |
| --- | --- |
| 服务端 | Rust · Axum · SQLite（rusqlite）· Tokio |
| 前端 | React 19 · TypeScript · Vite · OpenSheetMusicDisplay |
| 音频 | Web Audio API · 实时音高检测 · Salamander Grand Piano 采样（CC BY 3.0） |

## 快速开始

前置要求：Windows、Rust 工具链（edition 2024）、Node.js 20+ 与 pnpm。

```powershell
git clone https://github.com/<your-name>/music-practice.git
cd music-practice
pnpm install
.\scripts\Build.ps1 -Release   # 运行 Rust 测试、前端测试、类型检查并构建服务
.\scripts\Start.ps1            # 启动本机服务（http://127.0.0.1:3210）
```

停止服务：

```powershell
.\scripts\Stop.ps1   # 只停止本项目启动并核验过身份的进程
```

日常开发也可以分别运行：

```powershell
cargo run        # 后端服务
pnpm dev         # 前端 Vite 开发服务器
pnpm test        # 前端单元测试
cargo test       # 后端测试
pnpm check       # TypeScript 类型检查
```

### 可选：视觉模型识谱

识谱功能需要一个 OpenAI 兼容的视觉模型 API。在网页「设置」中填写地址、模型名与密钥即可；密钥只保存在服务进程内存中，重启后需重新填写，不落盘。若模型运行在远程主机上，可用 SSH 本地转发接入：

```powershell
.\scripts\Start.ps1 -VlmSshHost <ssh-host>   # 将 127.0.0.1:18080 转发到远端 8000 端口
```

不连接模型时加 `-NoVlm` 启动，其余功能不受影响。

## 项目结构

```
src/        Rust 服务端：API、SQLite 存储、谱面模型、识谱、平台元数据抓取
web/        React 前端：谱面编辑与渲染、播放、音高监听、曲库、愿望单
tests/      Rust 集成测试与浏览器端到端脚本（node tests/*.mjs）
docs/       设计文档、API 契约、数据与时序说明、转谱格式约定
scripts/    构建 / 启动 / 停止脚本（PowerShell）
tools/      识谱离线评估与引导识别工具
public/     静态资源（钢琴采样）
data/       运行时数据（SQLite 曲库与素材文件），不入库
```

## 数据与备份

歌曲、谱面历史、录音与素材保存在 `data/` 目录（已被 .gitignore 排除）。完整备份应先停止服务，再复制整个 `data/`；恢复同理。工程 JSON 导出包含资料与素材引用，不含二进制文件。

## 已知限制

- 仅支持单声部线性主旋律与全局 BPM / 调号 / 拍号，拒绝音符重叠；复杂多声部、中途变速变调转调、反复展开与结构重排尚不支持
- 自动识谱为实验性功能，未通过准确度验收：校验通过不等于转谱正确，必须人工逐小节校对
- WAV / 人声混合渲染限 15 分钟
- 真人听感、现实噪声、蓝牙延迟等仍需实测验证

## 文档

- [需求](docs/01-requirements.md) · [架构](docs/02-architecture.md) · [数据与时序](docs/03-data-and-timing.md) · [体验与音频](docs/04-experience-and-audio.md)
- [API 契约](docs/api-contract.md) · [当前状态与交接](docs/07-handoff.md)
- [识谱与外部导入](docs/08-recognition-and-external-import.md) · [外部转谱约定](docs/09-external-transcription.md)
- 转谱 JSON 格式：[Schema](docs/formats/shengjian-score-v1.schema.json) · [示例](docs/formats/shengjian-score-v1.example.json)

## 致谢

- 钢琴采样：[Salamander Grand Piano](https://github.com/Tonejs/audio/tree/master/salamander)，Alexander Holm 制作，由 Tone.js 分发（[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)）
- 五线谱渲染：[OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)

## 许可

[MIT](LICENSE) © 2026 seelexia

钢琴采样为 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，署名见 [public/piano/README.txt](public/piano/README.txt)。
