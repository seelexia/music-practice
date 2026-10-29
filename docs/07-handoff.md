# 当前交接 · 音高图拖动与实时线 v7

2026-10-29，本机http://127.0.0.1:3210。用户本轮三项要求已实现并发布网页。仅前端更新，不重启服务或SSH，不改歌曲、音高点、录音、模型设置或数据库结构，模型识谱改进继续暂停。

## 功能与操作

- 每个共享黑色音高图右下角新增↘手柄，独立拖动宽和高。宽度受父列限制，390px不横溢出；手动图高使用内容布局，卡片内可滚动，检测设置不与图重叠。方向键每次16px，双击或Enter恢复自适应。整张卡片底部原有高度手柄保留。
- 可选do/re/mi等唱名、默认近似人声CDE音名都放在各自音符框上方3px。参考块保持6px高，人声框不再因显示文字额外增高。顶部预留32px容纳文字（无标签时16px），底部16px；轴标签、绘图、指针试听、滚轮锚点共用边距。窄块裁切、完整title/辅助说明和点击定位保留。
- 实时模式（独立测音/歌曲暂停独立监听）最新时刻白线默认在绘图区50%，从0秒即居中。拖白线至10%–90%，新数据保持选定位置；左右键每次2%，Home/End两端，双击或Enter居中。白线不seek、不改真实时间。开始时负时间视窗仅留空，不新增点或显示负秒。
- 歌曲实际跟随播放仍是原有35%/非负起点，左轴试听和谱面点击/暂停/循环保持原义。尺寸/比例是当前组件的视图状态，离开该图或刷新后回默认，不写Song或录音。

## 源码

- web/audio/PitchCanvas.tsx：独立尺寸和实时线比例状态、标签上移、统一padding、接线。
- 新web/audio/PitchPlotHandles.tsx：图框Pointer Capture与键盘/双击重置；实时线拖动/键盘。
- web/audio/pitch-interactions.ts与.test.ts：纯显示时间窗、游标比例、尺寸约束、带留白指针/滚轮；旧调用默认边距16兼容。
- web/audio/pitch-reference.css：手柄、实时线、上方标签和手动尺寸的内容布局。
- 本轮计划与 03/04、决定 D27–D29 及 README 已同步。

## 本轮验证

- 先观察失败：新增4项单元失败（时间窗/游标/尺寸函数缺失，32px边距不匹配）；固定浏览器报告确认缺少两种拖动、标签仍在框中。证据.run/pitch-v7-unit-red.log、.run/pitch-workspace-v7/red-report.json，旧源码副本也保存在该目录。
- 完整前端130/130、相关音高19/19及TypeScript通过；全套日志.run/pitch-v7-tests.log。按现有无npm环境使用node node_modules/tsx/dist/cli.mjs --test 'web/*.test.ts' 'web/audio/*.test.ts'和node node_modules/typescript/bin/tsc --noEmit；Rust/backend未改，无需重编译，也不把此前Rust测试当本轮证据。
- tests/pitch-workspace-v7-browser.mjs固定组件4组通过（.run/pitch-workspace-v7/report.json）：从0到长时间居中、鼠标/键盘移动白线、后续数据锚点保持、无seek、宽高独立变化、设置区不重叠、390px和重置、普通音名/唱名/参考音在框上方、最高音标签不裁掉。
- tests/pitch-workspace-v7-live-browser.mjs隔离真实App三组及实际3210部署三组通过，见.run/pitch-workspace-v7-app/report.json与.run/pitch-workspace-v7-live/report.json：独立页默认中央、图框/白线独立拖动、原音域不变、页面全屏/键盘、手机宽度/重置，0错误/阻止请求/数据库写入，无麦克风启用。
- 既有tests/pitch-reference-browser.mjs四组再次通过（.run/pitch-reference/report.json）：移调高亮、半音过滤、唱名、窄块title、标签点击/滚轮、独立测音。实际部署tests/floating-transport-v6-browser.mjs六组再次通过（.run/floating-transport-v6-live/report.json）：暂停/原位恢复、循环间隔取消、手机/页面全屏、歌曲音高高亮和唱名、离歌清除。
- 独立只读代码复核无重要/严重问题。补充验证了全屏/390px手动布局、重置、最高音标签在顶部2.5px以内可见、pointercancel结束拖线、32px轴试听C4、歌曲点击及真实wheel坐标锚点一致。可选建议仅为加强单轴拖动/歌曲点击的固定脚本断言，不影响发布。
- 固定点的截图已查看：.run/pitch-workspace-v7/resized-plot.png、mobile-labels-above.png，以及真实页面.run/pitch-workspace-v7-live下截图。合成点与未启用麦克风的页面检查不等于真人硬件或噪声实测。

## 发布与保护

发布源为经过真实App浏览器测试的.run/pitch-workspace-v7-app/dist，网页复制到dist前保留旧版，未清除旧hash资源；记录.run/pitch-v7-deployment.json。服务进程/原二进制SHA/本机监听及歌曲完整内容核验见.run/pitch-v7-final-report.json。此次测试全部浏览器内夹具/只读，没有新建或归档歌曲。

用户现存78首歌曲在发布前清单.run/pitch-v7-existing-before.json中，以ID/revision/完整文档hash核对，内容全部不变。最终汇总.run/pitch-v7-final-report.json通过，0歌曲写入；PID仍44008，原二进制SHA相同，仅监听127.0.0.1:3210。服务不重启、内存密钥保持，未访问设置/密钥/模型接口；所有测试只绑定本机。

## 历史与下一步

愿望单、英文歌词、参考音高亮和浮动播放暂停见上一交接记录；此前 9 首图片转谱见历史交接记录（均未随仓库发布）。不得重新运行批量转谱脚本覆盖用户纠错。等待用户反馈；不继续模型识谱实验，真人麦克风、噪声、蓝牙延迟等旧边界仍待现场验收。
