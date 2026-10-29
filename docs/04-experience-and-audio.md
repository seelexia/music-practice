# 界面与音频交互

实现更新 2026-10-27，v2：当前操作以 [README](../README.md) 和 [交接](07-handoff.md) 的 15 项结果为准。练习、识谱、音符编辑、原音对齐、录音、资料、素材已拆分；练习提供谱面/音高/可调分屏及整体全屏，独立音高无需歌曲。纸面简谱、单音数字/唱名编辑、谱面点选 A/B、0.10–4.00 倍钢琴速度、设备选择与自由网格范围已实现。

当前点音符从该音前预备拍开始，默认 1 拍，继续播放；整句起播为独立明确操作，取代下文旧版分句点击设想。对齐页点音只选音，通过独立原音频秒数建立映射。录音列表可明确确认删除记录及对应文件，保护原音频和其他素材。v2 运行版切换与重启后真实服务验收在本文记录时仍待主任务完成。

使用本地 Salamander 采样、明确的合成回退和 MediaRecorder；门限预设用于检测过滤，浏览器降噪/回声消除另设。尚无 RNNoise、设备延迟自动校准、任意分块音频或原唱分离。以下页面、AudioWorklet、设备中断和长录音细节含长期目标，未列入当前实现的部分不能视为已有功能。

## 页面

1. 曲库：歌曲、识谱状态、最近练习、导入、工程备份与恢复。
2. 导入向导：图片排序/裁剪 -> 音频 -> 模型配置 -> 识别进度 -> 重叠合并 -> 纠错 -> 对齐。
3. 练习工作台：上方全局控制，中间谱面/歌词，下方原音频波形与音高网格，右侧当前音名、输入电平与录音列表。
4. 纠错工作台：左原图、中可编辑谱面、右问题清单；点击音符联动原图；支持局部重识别、撤销、版本比较。
5. 设置：API、音频设备、降噪、音名编号、A4 基准、数据位置、备份。

简谱/五线谱/歌词可切换或并排，播放位置统一高亮。窄屏改为分页或可折叠区域，触控支持拖动 A/B，避免要求用户点击极小音符。视觉参考仅采用用户图中的网格与曲线语义。

## 全局控制的明确语义

| 控件 | 行为 |
|---|---|
| 原音频 / 钢琴 | 使用同一个 Transport；可调各自音量，默认互斥 |
| 半音移调 | 改钢琴实际声音与练习参考线，必要时重排谱面音名；原音频模式不开放此处理 |
| 八度 | 实际音高整体 ±12 半音，可直观看到中央 C=C4 等说明 |
| 调性 / do | 设置简谱 1 对应调，保留与纯八度调整的区别 |
| 音名编号 | 只改变显示，不改变声音；避免 C3/C4 命名差异混淆 |
| 速度 | v2钢琴支持0.10–4.00倍连续调整、精确输入及实际BPM；速度与音高独立；原音频固定1倍 |
| 起止点 | 音符/字/句、波形拖动、精确时间输入 |
| 循环 | 次数、结束点、真实秒间隔、预备拍 |
| 对齐 | 正负 offset、锚点拖动、当前模式与待校准段 |

更宽的速度/移调范围可开放，但应标出音质与音域限制；MIDI 超出 0–127 时阻止或明确报错，不能取模。用户人声实际曲线默认不随目标转调而伪造移动；只改变参考线和伴奏。

## 音频实现方向

浏览器端使用 Web Audio AudioContext 作为调度时钟，AudioWorklet 处理实时采样与 DSP；界面按音频时间绘制，不用 requestAnimationFrame 决定音符发声时刻。避免在实时回调内做网络、磁盘、大量分配和阻塞工作。

仅按照谱面即可生成 MIDI 并播放钢琴声：谱面给出音高、时值和速度，内置钢琴音源将音符事件合成为声音，无需从原音频提取钢琴。MIDI 文件保存演奏指令而非录好的波形；软件内会自动配好钢琴音源，用户不必另装播放器。可导出 .mid，也可将同一演奏渲染为 WAV。首版重点是谱面已有的主旋律钢琴，不凭空生成完整伴奏；谱面缺少速度时可由用户设置。

用户已将原音频变速与移调移出当前范围，本期不引入音频拉伸库或相关缓存任务。原音频保持原速原调，仍可定位、offset 校准、分段对齐和循环。切换音源保留音乐位置并显示新模式参数：原音频恢复 1 倍与原调，钢琴恢复先前练习预设。

长音频使用分块与缓存，避免解码全部曲库驻留内存。预先解码的音频与参考时间戳采用同一采样基准。蓝牙与不同设备的延迟需实测，不能宣称跨设备同样低延迟。

## 实时音高

输入 -> 设备格式统一 -> 可选高通/降噪 -> 音量门限 -> YIN/MPM 候选基频算法 -> 可信度判定 -> 八度跳变抑制/平滑 -> 曲线绘制。

曲线采用对数音高：m=69+12*log2(f/A4)，默认 A4=440 Hz；纵轴按半音网格，允许自选音域与自动跟随。当前音分偏差相对最近目标或最近半音可切换。参考谱线是理想音符阶梯，不伪称是原唱实际颤音曲线。

单独控制：
- 输入增益/输入电平；提示削波。
- 噪声门限 dBFS，可由几秒环境采样建议值。
- 基频可信度门限；不是同一个“音量”参数。
- 频率上下限，减少环境低频或高频误判。
- 平滑强度与响应速度，保留可选原始轨迹避免掩盖颤音。
- 浏览器降噪/回声消除/自动增益的支持状态与实际配置。
- 自定义降噪关/轻/中/强候选；具体可控程度取决于算法，不能把布尔开关伪装成连续降噪。

RNNoise 可作为评估对象，但歌唱长音、气声、颤音和低音必须验证；语音降噪可能改变有效基频信号。保留原始人声和独立检测处理路径。清音、静音与低可信度时留空，不绘制虚假的稳定音高。伴奏串入麦克风可能导致跟踪伴奏；默认建议耳机，提供回声消除模式并显示取舍，不承诺在任意环境完美分离人声。

## 录音

显式开始/停止，清楚显示录音状态。优先保留干声；可选导出含伴奏混音，但记录轨道来源。浏览器支持格式在运行时探测，不能假定所有浏览器都能录制同一种 WebM/WAV。低漂移需求考虑 AudioWorklet PCM 分块并对长录音背压，MediaRecorder 作兼容路径；单块失败可恢复已保存片段。

输入延迟、输出延迟、降噪/DSP 延迟、歌曲 offset 分开保存。回放时可独听人声、钢琴/原音频或混合；混合使用录制时事件时间线而非重新猜测。用户切换输入设备、权限撤回或音频中断时暂停并提示，不留下误导的录音中状态。



## v3 implemented interaction (2026-10-28)

Library/archive use separate overview screens with keyword AND and exact metadata-tag AND filters; My Library returns/reset filters and unmounts song playback/mic. Archive deletion is reversible trash, retaining local files/history. Recording/saving blocks navigation; unsaved score/info preserves confirmation.

All shared pitch charts support non-passive cursor-centered wheel zoom including the label overlay, isolated piano audition on axis pitches, optional stable rounded-semitone boxes with silence/continuity breaks, page fullscreen with Escape and explicit vertical drag/keyboard handles. Page fullscreen is an in-window fixed workspace; practice views now keep only in-window fullscreen (v5); browser F11 remains outside application control. Whole split height and divider ratio are independent. Approximate boxes do not replace the score or promise exact transcription. See current handoff for verified desktop/mobile behavior and hardware limits.


## v5 implemented interaction (2026-10-29)

Practice, split, song pitch and standalone pitch keep only browser-internal page fullscreen. Esc restores the page; use the browser for display fullscreen. Resizable workspaces default to max(320px,100dvh−100px); explicit height overrides that default, reset restores responsive sizing. Page fullscreen allocates remaining space after transport/toolbars, with internal scrolling and no redundant vertical handle. Split ratio remains independent.

Staff receives the same beat as numbered notation. Every tied graphic fragment and lyric is bound to the canonical event; highlighting follows the current fragment, clears in gaps, and rebinds after font zoom or container resizing. Size16..52 controls numbered text and OSMD zoom (size/32). The editor also permits16. Legacy exporter sound-only tempo directions require a visual metronome direction for OSMD to retain the first measure; the display adapter inserts that annotation without changing events or stored/exported data. Any remaining measure-parse error shows a numbered fallback instead of silently shifting clickable notes.

Shared pitch charts offer chromatic or natural-note guides, plus six-semitone vertical pan preserving fractional zoom span and clamping at MIDI0..127. This never quantizes measured/reference pitch or approximate sung-note boxes. All song/replay/standalone contexts share the controls.

Library/archive batch mode snapshots selected song revisions. Select-all covers current search/tag matches; changing filters clears selection. Actions run per song and continue after failures, exposing the exact failed titles and reasons. Successful items are deselected, failures retained; re-read is explicit before retry. Archive/restore and tag add/remove are reversible metadata edits. Archived-only delete previews exact targets and moves them to the existing recoverable trash, preserving files/history. Navigation is held while the batch runs; browser unload warns before interrupting it. Batch operations are not a global transaction.

## 双行歌词（2026-10-29）

外部提示词与示例支持两遍歌词、翻译、空耳。简谱/歌词视图用同一音符内的两行文字，上行缺词仍预留位置；五线谱显示编号歌词行并同时高亮。音符编辑的第一行、第二行分别输入，Enter应用，修改一行保留另一行及所有时间字段。已有单行不强制加空行，旧有更多行不截断。歌词文本按乐句中的每一行拼接，MusicXML网页下载转换为编号lyric，工程保留LF。

第二行只是对齐文本，不是新增音轨、TTS或反复引擎；原词与翻译不必等长，可以按词或短语挂接。完整语言排版/自动翻译不是此次功能；v6起每个已挂接的词/音节不在内部拆行，密集小节在谱面容器内部横向滚动。行角色可保留在来源包的provenance中，不驱动播放。

## v6愿望单与练习可读性（2026-10-29）

侧栏和手机顶栏有愿望单入口与数量。添加时只需歌名，详情只显示资料编辑，不显示练习/识谱/上传工具。可修改歌手、专辑、词曲、介绍、标签、平台链接及已有封面读取入口。点“开始补全”保留同一记录并进入素材；未保存资料时先保存。愿望可搜索/筛选/批量管理，归档和回收站沿用现有可恢复流程，恢复愿望回到愿望单。

简谱按实际歌词字形给音符格和小节最低宽度，保留整个词/已转录音节、词间空格及LF上下行；不再用overflow-wrap:anywhere把英文拆成竖排。整体小节换行，过宽小节只在谱面中横向滚动，页面宽度不随之扩张。播放跟随同时处理纵横两个方向。

音高左轴当前参考音高亮，完整音名始终保留（在音域内时），即使关闭半音网格或音域很宽导致其他轴标签稀疏。共享“显示唱名”默认关闭；开启后参考块和近似人声框显示首调do/re/mi/fa/sol/la/si及升降号。短块中的文字裁切在本块内，悬停与辅助阅读保留完整名称，仍可点击定位和滚轮缩放。

练习/分屏/歌曲音高视图共用主播放控制。主播放按钮滚出视野、练习区仍可见时，窗口底部显示浮动歌名、状态和播放/暂停，以及返回主控按钮。该按钮调用同一transport，暂停不会重新定位，循环间隔暂停会取消下一遍。页面全屏内部滚动和手机安全区同样适用；切到资料或离开歌曲后浮动栏不残留。浮动栏出现时预留底部空间，录音的开始/停止仍由录音按钮控制。

## v7音高图独立拖动（2026-10-29）

黑色音高图右下角有↘手柄，可同时拖动宽高；宽度不超过所在列，窗口收窄时保持不溢出。方向键微调，双击或Enter恢复自适应。原有整张卡片底部高度手柄仍保留，图框手动高度按内容布局并在卡片内滚动，检测设置不会与图框重叠。

普通音名与可选唱名都显示在各自音符框上方，顶部留出文字空间；短块裁切和完整悬停说明仍保留。图的尺寸或标签开关变化后，纵向坐标、轴试听、滚轮缩放使用同一组边距。

独立测音和暂停时的实时监听，最新时刻白线默认处在绘图区中央，右侧留出后续空间。直接左右拖动白线可设置10%–90%的横向位置，新数据继续在该位置出现；左右键微调、Home/End到两端、双击或Enter居中。拖线不更改音频时间、曲谱位置或录音。歌曲播放跟随模式保留原有定位行为。
