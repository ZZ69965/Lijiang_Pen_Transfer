# 交互画卷技术架构 v0.2

## 固定技术栈

PixiJS 8 + TypeScript 严格模式 + Vite + React 19 + CSS。GitHub Pages 静态发布；无需服务端。**React 仅负责界面，Pixi ticker 更新世界坐标、素材透明度和人物帧，不通过 React 每帧触发渲染。**

## 数据流

```text
App.tsx [主页/导航/时辰/交互/字幕]
    ↓ props / callbacks
ScrollStage.tsx [创建/销毁，转交事件，Engine 生命周期]
    ↓
ScrollEngine.ts [Pixi Application + 世界坐标 + 相机 + 角色 + 水纹 + 触屏事件]
    ├── 3 × Sprite 原生画卷 2172×724 (alpha crossfade)
    ├── 4 × Marker (clickable Graphics)
    ├── 人物与接触影（沿岸线定位，按时辰的前景 alpha 遮罩裁切）
    └── Ripple Graphics (独立水面波纹特效)
```

## 关键原则

- Vite `base: '/Lijiang_Pen_Transfer/'`；运行资源通过 `import.meta.env.BASE_URL` 拼接。
- 世界固定 `WORLD_WIDTH=2172`, `WORLD_HEIGHT=724`，保持原图比例，不随屏幕拉伸。视口使用相机 scale + position 裁切。
- 主页使用 `<img>` + CSS object-fit:cover 作为宣传封面；进入场景后 Pixi 保持原图宽高比。
- 背景切换**直接替换独立昼/夕/夜绘制**，通过 alpha 交叠过渡，不用 Tint 冒充独立画卷。
- Hero sprite `anchor=(0.5,1)` 脚底锚点；人物仅是关键姿态。后续使用正式 Atlas 的逐帧动画取代。
- 角色在测定的本地岸线节点上步行，`src/content/walkway.ts` 的 `walkwayAt(x)` 同时给出脚底 Y 和纵深高度。五种姿态在每个世界位置共用 `height / HERO_REFERENCE_PIXEL_HEIGHT` 缩放值，随岸线远近连续透视缩放。
- `public/art/foreground-mask-{day,dusk,night}.webp` 使用对应原画实测的 alpha 轮廓；Pixi alpha mask 裁切整个 walker group，格栅孔洞保持可见。加载与遮挡跟随 `displayedScene` 的昼/夕/夜原画同步。
- 静态资源为全分辨率 lossless WebP；显示加载状态，不在仓库提交任何低质量预览版。
- Pixi 实例创建一次，React StrictMode 下允许组件销毁/重建；input 监听按生命周期清理。
- `prefers-reduced-motion` 关掉人物弹跳和淡入的平滑运动。
- 不在运行时调用后台 API，不加载未授权外部文字、字体、录音。

## 优先拆分模块

1. 分场景绘画原稿（山体、远景、岸线、桥栏、倒影、前景）并增加世界高度与遮挡图。
2. 独立步行动画 Atlas 和专用事件状态机，避免关键姿态单张模拟连续脚步。
3. 把时辰三套的角色/建筑事件内容配置化，实现对山歌事件字幕、授权音频与退出/跳过。
4. 首屏改为 day 快速呈现，夕照/夜景和不使用的 pose 后台加载，提高弱网体验；仍保持原始分辨率。

## 四体验时段与事件分层（扩展）

体验时段：`morning/noon/dusk/night`，原始背景三幅：`day/day/dusk/night`。分别使用 `artworkForTime()` 数据函数，不重复创建贴图；剧情列表位于 `src/content/encounters.ts`，提供静态位置、选择与行为。Pixi Graphics 热区触发 `onEncounter(id)` → React 对话，不应把 JSX 拼入 Pixi ticker。

夜间镜头、灯光与倒影节拍由独立数值参数控制；`NightMusic` 已将原创器乐的实际频谱接入 `setAudioEnergy`。无音频的程序节拍仍明确称作「静音节奏预览」，正式山歌人声尚未到位。详见 `docs/INTERACTION_PLAN.md`。

**已完成演示接口**：`src/engine/NightEffects.ts` 是独立的轻量矢量光效图层，支持 `{view, lights, rhythm, drones}` 与未来真实音频能量输入 `setAudioEnergy(0..1)`；`src/app/ScrollStage.tsx` 桥接状态，`App.tsx` 提供可访问选项。夜间纹理始终用原幅 `scene-night.webp`，特效不会修改图片文件。

## 实际新增素材与音频链路（Demo 0.4）

`src/content/encounters.ts` 的每个热点包含 `spriteFile / spriteWidth / worldX / worldY`。引擎加载原有无损背景和人物后即可进入场景；四张次要透明插画随后通过 `Promise.all(... Assets.load)` 异步加载，单张出错只保留可用热区，不产生黑屏。

夜间独立音频控制器 `src/engine/NightMusic.ts` 在 React 用户真实点击后才创建 `AudioContext → MediaElementSource → AnalyserNode → destination`；`ScrollEngine.tick` 读取 `sampleEnergy()`，不通过 React 60FPS 更新状态。`NightEffects` 在 music=true 时取消程序化节拍、改用真实 FFT 值。停播/退出夜景清零能量，默认静音并尊重减少动画偏好。

## 加载、快照与输入所有权（M0.5，2026-11-13）

```text
src/content/assets.ts    planAssets(time)：critical = 当前画卷 + 正面/行走（夜间加对山歌）
                         deferred  = 其余画卷与姿态；resolvePose() 提供姿态回退
src/content/walkway.ts   岸线、引桥与桥面的脚底位置，以及同坐标的透视高度
src/content/viewport.ts  fitZoom / clampLeft / resizeCamera：旋转保留世界中心
src/content/snapshot.ts  SceneSnapshot + readSnapshot() 校验，只做同次访问内恢复
src/content/market.ts    鱼市状态机（纯函数，非法动作返回同一对象）
src/content/async.ts     AsyncEpoch（过期异步结果）与 AudioIntentQueue（播放竞态）
src/engine/ScrollEngine  纹理缓存、后台预取、加载状态回调、输入锁、capture/restoreView
src/app/ScrollStage      forwardRef 暴露 captureView()，供进入过场前抓取快照
src/app/FishMarket       只看阶段 UI，逻辑全在 content/market.ts
```

规则：

- `onReady` 只等当前画卷；非关键资源失败写入 `failedLabels`，**不得**进入 `onError`。
- 切换时辰时若目标画卷未到，**保留当前画卷**继续显示，绝不淡入空白画布。
- 输入所有权唯一：`inputLocked`（对话/指南/过场）时引擎清空按键与指针并拒绝新行走。
- 快照只存"位置与结果"，从不保存"正在按住行走"或"正在播放"。

## 用户无人机画稿层（2026-11-15）

`content/droneArtworks.ts` 记录两张画稿与原幅比例；`engine/NightDroneShow.ts` 管理独立 Pixi Container、按需纹理缓存、淡入与取消过期请求。`ScrollEngine` 将其放在原画上方并按视口适配，通过 `LoadStatus.drone` 只回传离散加载状态，不逐帧更新 React。

`App` 在夜游中提供一个「欣赏无人机画稿」入口；进入时收起大卡片，使用一张紧凑的切换/收起工具条。只有入夜且夜景纹理可用时显示图片；切时辰、换景、重播/卷尾、返回首页都会收起，卸载后晚到的请求不得重建画面。Escape 收起并将焦点还给故事入口；减少动画时静态显示。原有 59 个程序化光点已移除。此为二维用户画稿展示，不包含飞行轨迹或演出复原。

## 独立 Three.js 场景（M0.4）

入口与卷尾是**相互隔离的 3D 过场**，不改变原有 Pixi 世界的纹理/坐标：`src/app/ElephantIntro.tsx` 管理过场字幕、诗词、跳过/返回；`src/engine/ElephantIntroScene.ts` 负责立体几何、材质、三维相机与销毁。通过 React `lazy` 与动态 import 按需加载；主要画卷依然只有 PixiJS。Three.js WebGL 资源在进入/返回长卷时释放。详细分镜与限制见 [INTRO_SEQUENCE.md](INTRO_SEQUENCE.md)。
