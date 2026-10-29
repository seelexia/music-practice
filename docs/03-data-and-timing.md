# 歌曲数据、时间映射与纠错

实现更新 2026-10-27，v2：本文后半部分保留长期目标，不能视为全部已实现。当前接口以 [api-contract](api-contract.md) 为准：线性单声部 Note、全局 BPM/调号/拍号、乐句和来源页、offset/单调锚点。使用有界浮点拍数，导出时量化并拒绝时间重叠；尚无有理数拍数、显式重复图或结构段映射。当前增加可选印刷小节与行裁剪来源；尚无可拖框原图区域编辑器。

## v2 已实现的数据语义

- Song 新增可选 `lyricsText`，最长 20000 字，按非空文本行表达用户确认的乐句。旧工程缺字段仍可读；输入中的换行与文本保存到歌曲，本地未保存草稿另存当前浏览器。新识谱可携带此文字作为提示依据，不能因此宣称模型逐字正确。
- 独立 `mode=lyrics` 任务只提议 `Note.lyric`、`Note.phraseId`、`Score.phrases` 和状态。范围必须依序连续覆盖所有音符，挂词序号严格递增且不能落在休止/未知音；每行文字去标点/空白并忽略大小写后必须与该行挂词一致。音符 ID、顺序、音高、起拍、时值、小节、来源和其他字段通过原稿对比保持不变；人工原文仍完整保存在 `lyricsText`。应用歌词与谱面、历史、任务状态在同一事务中完成，受当前版本保护，歌词任务不能去重或删音。
- Score 可选 `measures:[{id,startBeat,duration,expectedBeats?,sourcePage?,row?,pickup?}]`，Note 可选 `measureId`。duration 保存模型实际读取的拍数，expectedBeats 保存拍号对应的完整小节拍数；弱起显式标记。符号读数 `rhythmEvidence` 可保留下划线、附点、延长线和连音比例及独立计算结果；矛盾标为不确定并提醒，不自动缩放音符时值。
- 前端仅在小节覆盖、连续时间和音符归属有效时使用印刷小节边界；旧稿或过期信息按全局拍号布局。改音高、歌词、乐句不重排时间；改时值按差值平移后续音符，保留前置和音间空拍。插入增加该音时值，删除只收回该音占用时值。改时值、插删音符或改拍号后清除旧 `measures`/`measureId`，避免把过期边界提交到新版本。未知 JSON 字段保留。
- 按行识谱记录原图 ID、像素裁片、原件和送出图哈希、尺寸及谱头裁片高度；在像素/边长限制内最多放大 4 倍。可靠性不足时回退整页并警告，尤其上部存在疑似谱行时不能直接丢弃。多行裁片按原 sourcePage 组合，再进行相邻原页重叠检查；不是逐行互相去重。
- 原音对齐有独立原音频秒数时钟，谱面点击只选择对应音，不强制跳转该音频。单点建立 offset，双点/多点使用单调锚点；两个锚点可推导当次钢琴练习倍率，保留印刷 BPM。负 offset 表示原音频省略了谱面开头；映射为负秒的原音频起播从 0 秒开始，并显示对应谱面位置，不能播放不存在的源片段。
- 录音删除是明确确认后的独立写操作，只针对该歌曲、该 recording UUID。检查版本、数据库所属、素材种类和规范路径，先把文件暂存，再提交歌曲/素材记录删除；数据库失败恢复文件。普通错误有回滚，进程崩溃可能保留暂存文件，不能宣称文件系统与 SQLite 跨系统原子提交。

v2 的源码/夹具结果与尚待部署验收见 [07-handoff](07-handoff.md)。以下 occurrence、多对多歌词、变速图、结构段映射和自动延迟校准仍是长期设计。

## 一份权威模型，多种派生视图

内部采用带 schemaVersion 的 SongDocument，不能只用 MIDI：MIDI 不足以保存原图位置、简谱语义、拼写、歌词和纠错来源。MusicXML 用于互通，不代替项目模型。

主要对象：Project、Asset、SourceRegion、ScoreRevision、Part、Measure、Note、LyricToken、Phrase、PlaybackOccurrence、AlignmentRevision、PracticePreset、Take、ProviderProfile、RecognitionJob。

每个实体使用稳定 ID；音符以有理数四分音符拍数表达 onset/duration，避免浮点累加。保留调号、拍号、速度变化、弱起、临时升降号、连音、延音线、休止、八度、声部、重复结构。音高保存 step/alter/octave 和可推导 MIDI 值；简谱保存调内级数、变化和上下点。支持乐曲中途转调；无法确定的字段为 unknown，不填假数据。

LyricToken 按可见字素与音节保存，不能按 UTF-16 字节偏移定位；歌词与音符为多对多关系，支持一字多音、多字一音、多段歌词、无词前奏与延音。Phrase 是独立可编辑实体，不把图片行或标点直接当成乐句。

SourceRegion 保存原件 ID、裁片变换和原图归一化边框。多个重叠图片可指向同一音符。每次修订保存父版本、编辑记录、来源、模型与提示词版本、结构检查结果和人工确认状态。模型自报置信度只是提示，不能作为已校准概率。

## 识谱流水线

1. 保存原件与哈希，用户确认图片顺序；生成旋转校正、对比度和分行裁片等派生图。
2. VLM 读取整体调号、拍号、速度、结构，再按行/小节提取音符、歌词、位置与候选值；上下文包含相邻区域。
3. 严格验证 Schema、字段范围、节拍总长、弱起与连音规则、歌词关联和重复结构；有问题进入待复核队列。
4. 重叠检测结合图像区域、音符/时值序列、歌词和邻接顺序。只提出同一来源区域的去重候选，不因旋律相同就删除真实副歌。
5. 展示原图与候选差异；不确定区域保留两个候选，可手动指定“从这里开始接下一张”。
6. 用户纠正并生成正式版本；可先试听草稿，但必须显示待确认状态。人工锁定字段不被重跑覆盖，采用基于父版本的差异合并。
7. 从正式版本生成简谱、MusicXML/五线谱、MIDI 与参考音高。依赖变更使对应缓存失效。

VLM 请求可以失败、超时或返回不完整 JSON。保存失败原因、可重试步骤与版本；不能把失败解释为“歌曲没有音符”。初期不保证任意手写、模糊、复杂排版都能正确识别。

## 四个时间坐标

1. 谱面拍位置 b：原始乐谱中的位置。
2. 演奏拍位置 u：重复展开后的线性位置，包含 occurrenceId；同一副歌可能出现多次。
3. 原音频位置 a：原始解码音频中的秒数。
4. 本次练习播放时间 p：随倍速、循环、间隔、暂停变化的真实会话时间。

另保留 AudioContext 的硬件调度时间及录音样本时间，不能用 UI 动画计时器代替音频时钟。

简单对齐：a = T(u) + offset。T 是由速度图积分得到的谱面秒数。正 offset 表示谱面起点对应音频更晚的位置，例如 +2 秒代表音频前有 2 秒前奏。

分段对齐：锚点 (u_i, a_i)，在对应连续段内使用单调映射 A(u)，首版可采用分段线性插值。音频版本有漏唱、加间奏、额外重复或不同结构时，先建立 segment/occurrence 对应；不能强行用一条连续单调线连接不对应的音乐。无映射区显示未对齐并限制误导性同步。锚点外推必须显式标注估计。

编辑时值、分句、重复结构可能使既有对齐失效；将受影响锚点标为待检查，不静默移动它们。对齐绑定歌曲版本、音频素材和解码基准，MP3 编码延迟差异通过统一解码产物或校准处理。

## 播放的两个时基

- 原音频模式：a 按原速推进，u=A^-1(a)，不对音频作移调或拉伸。参考线按映射跟随；若谱面与原唱原本不在同一调，使用单独的原唱音高校准值，不改变原音频。
- 按谱钢琴模式：u 按谱面速度图及用户倍率推进，音符按用户移调量发声；完全不依赖原音频，可以独立练习。还可提供钢琴跟原唱节奏的选项，但不作为独立钢琴播放的前提。

切换音源保留当前 occurrence 与音乐位置，清理旧调度，并转换到新模式的时间。切回原音频时恢复原速原调，切回钢琴时恢复钢琴的速度/移调预设；UI 明示参数变化，不承诺变调变速后仍无感切换。原音频没有对应位置时提示选择已对齐位置。自动对齐只提建议，手动锚点始终可用。

钢琴固定速度倍率 r 时，谱面连续段 dp=dT(u)/r；原音频模式 dp=da。循环间隔是 p 的真实秒数，不随钢琴倍率改变。用户调整钢琴速度或切换音源时分段保存新映射，不能用一个最终倍率重算整段录音。

## 点击、循环与录音

v2 当前点击语义：点击音符/字，从该音起点减去预备拍后开始继续播放，默认提前 1 拍，可调；不强制整句播放。整句播放为明确的独立操作。谱面选循环时第一音设 A，第二音设 B，B 的完整时值包含在区间内；选择不自动播放，按播放开始。对齐页点击只选音。未来显式重复 occurrence 的多次定位仍待实现。

循环采用半开区间 [start,end)，绑定演奏位置与 occurrence；跨重复也能确定唯一顺序。状态机至少有 idle、playing、paused、loop-gap、seeking、recording、error；间隔结束前后清理旧音源与延音，避免双重调度。处理边界跨音符的截断、可选淡入淡出和计拍。

Take 保存原始人声、采样率、开始样本、设备延迟校准、谱面与对齐版本、算法参数、音高结果，以及播放/暂停/跳转/变速/移调/循环等事件轨迹。会话时间到歌曲位置可能多对一，必须按事件重建，不能只保存一个 offset。默认回放使用录制时参考版本，另提供与当前版本比较。


## v3 deletion and pitch coordinates (2026-10-28)

`Song.deletedAt?:string` is an optional ISO timestamp. Absence/null means normally accessible. A non-null value hides the archived song from regular lists and every ordinary owner-dependent operation. Only trash listing/restoration reads that document; restoration keeps archive status. UUID files, metadata, jobs and score history stay in place, so no cross-filesystem move or file-deletion rollback is necessary. `revision` advances for both transitions; model-job writes and transitions share the Store lock. Running/queued inference blocks deletion.

Pitch-grid vertical coordinates represent absolute MIDI semitones, independently of score transposition. Wheel zoom anchors the pitch under the cursor; clicking a left-axis pitch auditions that sounding pitch without changing the song timeline. Approximate human-note boxes are derived displays from voiced continuous samples, not stored replacements for the score and not model transcription. Silence and discontinuities split segments. Page fullscreen and UI height are view state, not song metadata.
# v4 portable score and recognition provenance

Portable score packages (`shengjian.score`, version1) are review-job inputs, not a replacement database. `sourcePackage` retains all submitted metadata, source names, fractions, annotations and provenance. Import maps only explicitly selected source IDs to current song score assets. Compilation emits the existing Score/Note/Measure model plus `durationFraction`, source IDs/rows and optional tie evidence. Old documents remain readable; no destructive migration.

All portable durations are positive rational quarter-note beats. Named rhythm evidence is compared using reduced integers; accumulated timing enters existing floating beat clocks only after validation. A bar anomaly is retained without rescaling. A tie fragment advances its printed bar cursor while its duration is merged into the preceding sounding event; the draft preserves fragment IDs/evidence. Slurs never merge events. Unknown degree=null stays distinct from degree0 rests and is marked uncertain; playback temporarily mutes it. Non-binary rhythmic preview uses an explicit beat label where full notation rendering is unavailable.

Recognition/import review jobs keep baseRevision. Application updates song revision, score history and terminal job status in one SQLite transaction. It does not automatically apply external title/artist/credits. New model jobs also retain bounded public tool trace, image hashes, checks, workflow version and explicit model coverage declarations. Ground-truth HTML is offline evaluation input only and never a runtime dependency.



## v5 staff display and pitch guides (2026-10-29)

No persisted data/timing schema changed. Staff source timestamps use whole-note units and are multiplied by4 to bind graphical fragments to canonical quarter-beat note intervals. Tied fragments map to their full source event; explicit rests can highlight and generated gaps stay unbound. The legacy sound-only MusicXML tempo direction is adapted in memory before OSMD loading, since that renderer otherwise discards the first measure and shifts subsequent timestamps. Stored score, exported file, BPM and transport clock are unchanged. Parse failures fall back visibly rather than allowing shifted seek/highlight targets.

Natural-note guide mode changes only grid/axis pitches; detected MIDI values remain fractional. Vertical panning translates both bounds equally with boundary clamping, preserving their span and the transport position. Library batch writes retain existing per-song revision guards and do not alter score/history semantics.

## 双行歌词兼容约定（2026-10-29）

不迁移数据库、不升级shengjian.score v1。音符lyric保留字符串，以LF分隔同一音符上的两行；CRLF/CR在网页显示/编辑时归一为LF，空上行、词间空格保留。单行仍有效，旧有更多行文本不静默截断。合计1000 UTF-8字节。provenance.lyricRows可作为来源说明记录两行角色，但不是播放状态、并行声部或额外时间轴。

所有行共享同一beat/duration/phraseId。拖腔逐行留空，tieFrom续片必须整体空字符串。不同的歌词不新增起音或展开反复；不同时值的第二遍须用实际独立音符段表达。编辑其中一行保留其他行、音符ID与时间；导出歌词先在乐句内部按行连接，避免逐音符交错。网页五线谱/下载把已有单个text内LF转换为MusicXML编号lyric行，服务端原导出序列化不变。原始转谱包、审核、revision和历史保护沿用既有机制。

## v6愿望单分类与显示状态（2026-10-29）

不改API/数据库结构。愿望单沿用Song，保留标签`愿望单`表示分类；普通活动曲库排除该分类，愿望单列表只选该分类，归档同时保留两类。不存在该标签的旧歌仍属普通曲库，不能按“没有音符/素材”猜测分类。上线前67条原记录没有同名标签，无需批量改写或迁移。分类标签从普通标签输入、搜索词与筛选列表中隐藏，资料和批量用户标签编辑保留它；普通输入不能借此悄悄改变分类。

新建先使用现有POST得到Song，再用revision PATCH加入分类；收到创建ID后先保存本机恢复ID，分类失败/响应丢失后刷新重试读取同一ID及新revision，不重复POST。两步不是原子事务；创建响应本身丢失、清除浏览器存储等情况不承诺跨请求幂等。补全仅移除分类标签，不创建另一首歌，不改score、alignment、assets、links、历史等字段，沿用同一ID进入素材页。没有新增“未补全”的强制完整性条件。

歌词排版、音高高亮/唱名开关、浮动控制条都是视图状态，不改音符、字词、LF、拍点或录音事件结构。音高轴高亮使用当前播放事件的MIDI加当前移调；休止、空拍、暂停/循环间隔、隐藏参考线与独立监听无参考高亮。唱名按当前key与移调后的首调读数（独立监听C调），不量化输入、不改变参考数据。

## v7音高图显示坐标（2026-10-29）

实时监听最新时刻t、窗口跨度s、用户选定的横向比例r（默认0.5，允许0.1–0.9）决定显示窗口`[t-s*r, t+s*(1-r)]`。即使刚开始t=0也居中；负时间区域仅留空，不新增音高点，不显示负秒数。拖动白线只改r，后续采集继续按真实at/beat记录；歌曲跟随模式仍用既有35%和非负起点，不把拖动当seek。比例和图框尺寸只是当前组件视图状态，不写Song或录音。

参考/近似人声标签移到音符框上方3px，近似人声的普通CDE音名也上移。需要标签时绘图区上留32px、底部16px；画布、轴标签、指针试听及滚轮锚点统一使用这组padding。全曲移调/音高点/时长/框的近似算法不变。
