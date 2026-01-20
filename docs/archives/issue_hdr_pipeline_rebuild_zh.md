# Issue：重建渲染管线以实现正确的 HDR/PBR（桌面优先）

## 摘要
目前我们的 Three.js 渲染 + 后处理堆栈，本质上更像是 **LDR 管线** 上叠加了一些“看起来像 HDR”的效果（ACES 色调映射、尝试 half-float、Bloom）。关键问题在于：**色调映射（Tone Mapping）与色彩变换发生得过早（在 Base Render 阶段就被应用）**，同时 **HDR 中间缓冲并非稳定存在**（会根据设备/扩展悄悄退化）。因此：Bloom/合成更像 LDR 的“加亮特效”，而 IBL 环境（Room/HDRI）也更容易出现“发白、扁平、阴影/AO 分离弱”的观感。

本 Issue 提出一套 **系统性 HDR/PBR 管线重建方案**（不是打补丁式缝补），尽量遵循现代 Three.js 的 best practice：

- **线性工作流（scene-referred）**：照明 + 合成全程在线性/HDR 域完成
- **HDR 中间目标（HalfFloat）**：作为桌面优先的硬性不变量（而非可有可无）
- **单次、最终的色调映射 + 输出变换**：放在管线最后（display-referred）
- **域分离**：HDR 域效果 vs 显示域后处理（AA/film）
- **可观测性工具**：false-color 曝光、亮度直方图，停止靠“感觉”调参

目标平台：桌面浏览器（Chrome/Edge/Firefox）+ WebGL2。

明确延后/非目标：移动端完美兼容、显示器级别 HDR 输出（HDR10）、大规模资产管线重做。

---

## 当前状态（高层）
代码参考：`frontend/main.js`

- Renderer 使用旧版（r128）与 legacy encoding API（`outputEncoding` / `texture.encoding`）
- 后处理使用 `EffectComposer` + 自定义 Bloom 加法合成 + 电影化 shader
- 有实验性的环境切换（`env=canvas|room|hdr`），基于 PMREM。

当前观测到的典型现象：
- “HDRI/Room environment 下飞船发白且扁平”（不只是过曝，更像接触/遮蔽不足 + 能量分配失衡）
- Bloom 更像 LDR 的“整体变亮”，调参脆弱、不可解释
- AA 与 film 效果相互干扰（grain/CA 让 AA 更难看、更糊/更闪）

---

## 根因分析（为什么它仍然是 LDR 风格）

### 1）Tone Mapping 发生得太早
EffectComposer 的 `RenderPass` 会调用 `renderer.render(scene, camera)`。如果 renderer 在 base render 阶段就完成 tone mapping，那么后续 pass 拿到的是被压缩过的内容，Bloom/合成会退化为 LDR 的“加亮特效”。

### 2）HDR 缓冲并非稳定存在
如果 render target 实际退化到 8-bit（`UnsignedByteType`），整条链路就不再具备 scene-referred HDR 意义。

### 3）LDR 风格的加法合成
`base + bloom * strength` 在缺少正确 HDR 域输入与正确输出变换的情况下，会冲淡对比并造成“白一坨”。

### 4）HDR + IBL 的光能量未标定
强 Ambient/Hemisphere 再叠加 IBL 与主光源会抬平暗部；缺少 AO/contact shadow 时尤为明显。

---

## 目标

### 主要目标
1. **单次最终 Tone Mapping**：只在管线末尾进行（display-referred）。
2. **真正的 HDR 中间缓冲**：HDR 域后处理全部基于 HalfFloat（桌面优先）。
3. **物理一致的照明 + IBL**：能量分配与强度范围是“有意设计并可解释”的。
4. **Bloom 像 HDR 的光晕**：不是 LDR 的“白一坨”。
5. **可调试性**：曝光/过亮问题可度量，而不是靠猜。

### 次要目标
- 明确区分 HDR 域 pass 与显示域 pass。
- 提供清晰的 feature flag / toggle，便于调试和快速回滚。

---

## 非目标 / 暂缓
- 移动端优先兼容（不支持时可直接硬降级/禁用 HDR 管线）
- 显示器级 HDR 输出（HDR10）
- 大规模资产重做（先从运行时标定/渲染规则入手）

---

## Three.js 升级计划（锁定 r162）

### 选择 r162 的理由
- 提供 `THREE.NeutralToneMapping`（Khronos PBR Neutral）作为 PBR baseline。
- 移除 legacy encodings API，强制迁移到现代 ColorSpace 体系。
- 后处理链路中推荐使用 `OutputPass` 统一执行 tone mapping 与输出变换。

### ESM/无构建工具约束下的升级策略
- 采用 `importmap + <script type="module">`。
- 渲染入口与 three/addons 全部走 ESM import；其它 UI/DOM 脚本允许逐步迁移。

### 外链资源策略（HDRI/模型）
- 默认 HDRI 使用外链 `venice_sunset_1k.hdr`（debug baseline env）。
- 外链加载失败必须 fallback（回退到现有 canvas environment），并记录日志/提示。

---

## 实施细节补充（避免走弯路的硬约束）

### 1）AA / OutputPass 的顺序基线（第一阶段固定）
第一阶段严格采用 r162 官方示例顺序：
- SMAA：`RenderPass → SMAAPass → OutputPass`
- SSAA：`SSAARenderPass → OutputPass`

### 2）全局 IBL 强度（r162 需自行封装）
- `Scene.environmentIntensity` 是更高版本 three 中提供的属性；r162 需要自行实现等效能力。
- 本项目第一阶段选择：集中管理 PBR 材质的 `envMapIntensity` 来实现全局 `iblIntensity`（Option A），并保存每个材质的 baseline，避免漂移。

### 3）背景（background）与环境（environment）必须解耦
- `scene.environment`：仅用于 IBL（间接光 + 反射），可使用 `venice_sunset_1k.hdr`。
- `scene.background`：保持现有星空/nebula 风格（LDR/procedural），禁止用 HDRI 直接替代。

### 4）Debug MVP（Phase 0）
- `?debug=exposure`：false-color 显示过曝分段（>=1/2/4/8）
- `?debug=luma`：显示亮度灰度

---

## 分阶段工作计划（每阶段都有明确交付与验收）

### Phase 0 — 可观测性/调试工具（必须先做）
交付物：
- URL 参数开关的 debug view，能验证 tone mapping 前存在 >1.0 HDR 值。

### Phase 1 — 基础管线重构（ESM + ColorSpace + OutputPass 基线）
交付物：
- three@0.162.0 + importmap + ESM bootstrap
- 完成 legacy encoding API 迁移到 ColorSpace
- `OutputPass` 在 `finalComposer` 末端作为统一输出变换

### Phase 2 — 照明/IBL 标定
交付物：
- 收敛 Ambient/Hemisphere；明确 IBL 与主光（太阳）的能量分配。

### Phase 3 — AO / Contact Shadows
交付物：
- 引入 SSAO/SAO 或接触阴影，恢复接触与结构层次。

---

## 进展记录（Implementation Log）

### 已完成（当前分支）
1. 升级 three 到 r162（无 bundler）：`importmap + <script type="module">` 预加载并桥接 `window.THREE`，legacy 脚本 `defer`。
2. 迁移 renderer 与贴图的色彩管理到 ColorSpace API：`renderer.outputColorSpace`、`texture.colorSpace`。
3. 末端加入 `OutputPass`（作为统一 tone mapping + output transform 的基线）。
4. Phase 0 debug pass（位于 OutputPass 前）：
   - `?debug=exposure`（false-color 过曝分段）
   - `?debug=luma`（亮度灰度）
5. Option A：实现全局 `iblIntensity`（`?ibl=`）并集中管理 PBR 材质 `envMapIntensity`，保存 baseline 防漂移。
6. 修复升级后出现的 shader 编译失败（贴图“看起来没加载”的根因）：
   - 旧版 `onBeforeCompile` 注入使用了 `vUv`/`emissiveMapTexelToLinear(...)` 等旧变量/函数
   - r162 的标准 chunk 使用 `vRoughnessMapUv`、`vEmissiveMapUv` 等命名
7. Phase 2（物理摄影感照明标定）第一步：
   - 默认显著降低 Ambient/Hemisphere 填充光，暗面更暗、层次更像摄影曝光
   - 支持 URL 参数快速调参：`?exp=`（曝光）、`?sun=`（主光）、`?amb=`（环境补光）、`?hemi=`（半球补光）
8. 清理浏览器噪音：
   - 增加 `<link rel="icon" href="data:,">` 避免 `/favicon.ico 404`
   - 避免在图片未加载时强制 `texture.needsUpdate = true`，减少 `Texture marked for update but no image data found` 警告
9. Phase 3A（Contact Shadows / 飞船近场自遮蔽）：
   - `?ao=contact`：飞船材质注入 + 专用 ship depth prepass（保证可采样、每帧更新的 depthTexture）
   - 语义：仅影响太阳直射（directDiffuse/directSpecular），不影响 IBL/ambient/hemi，避免“本影里仍有阴影变化”
   - 调参：`csDist/csThick/csStr/csSteps`
   - 调试：`csDebug=1`（深度结构），`csDebug=2`（遮蔽场 occlusion 0..1，全屏替换输出）
10. 飞船白模基准：
   - `?mat=white`：仅飞船切白模（纯白漫反射基准），用于隔离光照分量/验证 contact 阴影
11. 行星遮挡太阳直射（解析硬阴影）：
   - `?ps=1`：对飞船材质注入 ray-sphere occlusion（只影响太阳直射，不影响 IBL/ambient/hemi）

### 已知问题/观察（记录，非阻塞）
- Firefox 可能对 Google Fonts 的 `Chakra Petch` 报 `maxp: Bad maxZones`（疑似 CDN/缓存导致字体解析警告），不影响渲染逻辑。
- WebSocket 断开/连接日志在刷新时出现，属于正常现象。

---

## 验收标准（Definition of Done）
1. Debug 视图确认：OutputPass 之前存在 >1.0 的 HDR 值。
2. Tone mapping 只发生一次，且位于管线末尾。
3. Bloom 对 HDR 高亮响应一致，调参有可解释性。
4. `env=hdr` 飞船呈现“金属 + 阴影/对比保留”，不再扁平发白。
5. AA + film 效果顺序稳定（不糊、不怪、不引入新闪烁）。
6. 桌面降级策略明确且有文档。
