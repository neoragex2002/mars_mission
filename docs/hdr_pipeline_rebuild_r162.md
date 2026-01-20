# HDR/PBR 渲染管线重构（Three.js r162，桌面优先）

> 本文档是本仓库 HDR/PBR 渲染管线重构的 **单一事实来源（single source of truth）**。
>
> - 规范性（Normative）：必须遵守的规则、约束、验证步骤。
> - 说明性（Informative）：背景、根因分析、实施记录。
>
> 参数开关与调试操作手册单独维护在：
> - `docs/debug_url_params.md`

---

## 0. 摘要（Informative）

当前渲染链路在观感上存在典型的“LDR 管线 + HDR 特效”问题：tone mapping/输出色域转换发生过早、HDR 中间缓冲不稳定、Bloom 合成可解释性差、IBL + 强 fill light 容易抬平暗部并导致发白扁平。

本重构的目标是建立一个结构正确、可调试、可校准的 HDR/PBR 基线：
- HDR 域（scene-referred / linear / half-float）完成照明与合成。
- 显示域（display-referred）只做一次 tone mapping + 输出变换。
- AA 与 OutputPass 顺序与 three r162 推荐一致。
- 用可观测性工具（false-color / luma）替代“凭感觉调参”。

---

## 1. 范围与约束（Normative）

### 1.1 目标
必须达成：
1. **单次最终 Tone Mapping**：tone mapping 只发生一次，并位于管线末端（display-referred）。
2. **稳定的 HDR 中间缓冲**：桌面优先，HDR 域 pass 基于 HalfFloat（满足能力时）。
3. **物理一致且可解释的照明 + IBL**：主光/补光/IBL 的能量关系可被调参验证。
4. **Bloom 像 HDR 光晕**：不是 LDR 的整体“白一坨”。
5. **可观测性**：曝光/过曝问题可度量、可定位。

### 1.2 非目标 / 暂缓
本阶段明确不追求：
- 移动端优先兼容（不满足能力时允许显式降级）。
- 显示器级 HDR 输出（HDR10）。
- 大规模资产管线重做。

### 1.3 平台范围
- 桌面优先：Chrome/Edge/Firefox，WebGL2。

### 1.4 three.js 版本与资源
- 目标版本：`three@0.162.0`（r162）。
- three/addons：同版本 `three@0.162.0/examples/jsm/...`。
- HDRI：默认外链 `venice_sunset_1k.hdr`（debug baseline env），加载失败必须 fallback。

### 1.5 工程约束
- 不引入构建工具（no bundler）。
- 渲染入口与 three/addons 走 ESM import；其它 UI/DOM 脚本允许逐步迁移。
- 外链资源必须满足 CORS；失败必须回退并记录。

---

## 2. 关键术语（Normative）

- **HDR 域 / scene-referred**：线性空间中进行光照与合成，像素值可 > 1。
- **显示域 / display-referred**：将 HDR 映射到 SDR 显示（tone mapping），并做输出色域转换（通常 sRGB）。
- **OutputPass**：r162 标准输出 pass，用于将 renderer 设置的 tone mapping 与输出变换应用到最终结果。
- **ColorSpace**：r162 色彩管理体系：`Texture.colorSpace` / `renderer.outputColorSpace`。

---

## 3. 根因分析（Informative）

### 3.1 Tone Mapping 发生得太早
EffectComposer 的 `RenderPass` 会调用 `renderer.render(scene, camera)`。若 renderer 在 base render 阶段就应用 tone mapping，则后续 pass 拿到的是被压缩过的显示域内容，Bloom/合成退化为 LDR 的“加亮特效”。

### 3.2 HDR 缓冲并非稳定存在
若 render target 实际退化为 8-bit（`UnsignedByteType`），整条链路失去 scene-referred HDR 意义。

### 3.3 LDR 风格的加法合成
`base + bloom * strength` 在缺少正确 HDR 域输入与统一输出变换时，会冲淡对比并造成发白。

### 3.4 HDR + IBL 能量未标定
强 Ambient/Hemisphere 再叠加 IBL 与主光，会抬平暗部；缺少 AO/contact shadow 时尤为明显。

---

## 4. 目标管线结构（Normative）

### 4.1 Pass 顺序（第一阶段固定）
第一阶段必须遵循 r162 官方示例的 AA→OutputPass 基线顺序，任何顺序改动都属于后续实验，不得与 HDR 基线重构混在同一阶段。

**HDR 域（scene-referred）**
1. Base Render（`RenderPass` 或 `SSAARenderPass` 作为 base render）
2. Bloom（`UnrealBloomPass` 或等效 HDR bloom）
3. Composite（HDR 合成：base + bloom）

**显示域（display-referred）**
4. AA：
   - SMAA（默认）：`SMAAPass`
   - SSAA（高质量）：`SSAARenderPass` 作为 base（见 r162 示例）
5. Output：`OutputPass`

**电影化（延后接入）**
6. CinematicShader：grain/CA/vignette（位于 OutputPass 之后；HDR 管线稳定后再接入）

### 4.2 Tone mapping 策略
- HDR 域阶段：禁止 tone mapping（必须 NoToneMapping）。
- 输出阶段：由 OutputPass 统一执行 tone mapping（baseline：`NeutralToneMapping`）。

### 4.3 ColorSpace 策略
- `renderer.outputColorSpace = THREE.SRGBColorSpace`。
- 所有颜色贴图（albedo/baseColor、背景星空贴图等）必须显式标注为 `SRGBColorSpace`。
- 所有数据贴图（normal/roughness/metalness/AO/height 等）必须保持 `NoColorSpace`（默认）。

---

## 5. ESM 迁移规格（Normative）

### 5.1 `index.html` 结构
- 使用 `<script type="importmap">` 声明：
  - `three` → `https://unpkg.com/three@0.162.0/build/three.module.js`
  - `three/addons/` → `https://unpkg.com/three@0.162.0/examples/jsm/`
- 使用 `<script type="module">` 作为渲染入口。

### 5.2 桥接策略（第一阶段允许）
- 允许将 ESM 导入的 three/addons 挂到 `window.THREE`，以便 legacy 脚本继续运行。
- 必须保证所有 three/addons 来源于同一版本（r162），禁止混用。

---

## 6. ColorSpace 迁移规格（Normative，针对本项目）

### 6.1 必须替换/删除的 legacy API
- 删除任何对以下符号的依赖：
  - `THREE.sRGBEncoding`
  - `THREE.LinearEncoding`
  - `renderer.outputEncoding`
  - `texture.encoding`

### 6.2 替换对照表
- `renderer.outputEncoding = THREE.sRGBEncoding` → `renderer.outputColorSpace = THREE.SRGBColorSpace`
- `texture.encoding = THREE.sRGBEncoding` → `texture.colorSpace = THREE.SRGBColorSpace`
- `texture.encoding = THREE.LinearEncoding` → `texture.colorSpace = THREE.LinearSRGBColorSpace`
- data textures（normal/roughness/metalness/AO）保持 `texture.colorSpace = THREE.NoColorSpace`

---

## 7. HDR RenderTarget 与能力检测（Normative）

### 7.1 强制能力要求（桌面优先）
最低要求：
- WebGL2。
- 支持 HalfFloat color buffer（`EXT_color_buffer_float` 或 `EXT_color_buffer_half_float`）。

### 7.2 行为要求
- 若满足要求：启用 HDR 管线（HalfFloat RT）。
- 若不满足：显式降级到 LDR 管线，并输出明确提示。

---

## 8. 环境（IBL）与背景（星空）规格（Normative）

### 8.1 强制解耦
- `scene.environment`：仅用于 IBL（PMREM 后的 env map）。
- `scene.background`：保持现有星空/nebula（LDR/procedural），不要用 HDRI 直接替代。

### 8.2 全局 IBL 强度（Option A）
- r162 不提供 `scene.environmentIntensity`，必须引入应用层 `iblIntensity`。
- 本项目选择 **Option A**：集中管理场景内 PBR 材质的 `envMapIntensity`（按 `iblIntensity` 统一缩放）。
- 必须保存每个材质的 baseline（例如 `material.userData.baseEnvMapIntensity`），避免重复叠乘导致漂移。

---

## 9. Debug / 可观测性（Normative，Phase 0）

### 9.1 必须实现的 debug 模式
- `?debug=exposure`：false-color 过曝分段（阈值：>=1、>=2、>=4、>=8）。
- `?debug=luma`：亮度灰度视图。

### 9.2 采样位置要求
- debug pass 必须插入在 OutputPass 之前（观察 HDR 域数值）。

---

## 10. 浏览器侧验证 Checklist（Normative，第一阶段）

> 目的：把“是否真的按规范工作”变成可重复的验证步骤。

### 10.1 启动与基础连通
- 启动：`./start.sh`
- 打开：`http://localhost:<PORT>/`
- 期望：
  - 页面加载正常，无白屏。
  - 控制台无 three.js shader compile/link error。
  - WebSocket 最终能显示 `connected`（刷新时的 disconnect/connected 属于正常）。

### 10.2 贴图与材质（ColorSpace 基线）
- 打开：`/?aa=none`
- 期望：
  - 地球/火星贴图可见（day map、mars diffuse）。
  - 控制台不出现 `vUv undeclared` 等由 `onBeforeCompile` 注入导致的错误。

### 10.3 Debug：HDR 值可观测（Phase 0）
- 打开：`/?debug=exposure`
- 期望：
  - 画面为 false-color（可见 >=1、>=2、>=4、>=8 分段）。
  - 发光体附近出现高亮分段，证明 tone mapping 前存在 >1 HDR 值。
- 打开：`/?debug=luma`
- 期望：
  - 画面为亮度灰度视图。

### 10.4 AA：SMAA / SSAA
- 打开：`/?aa=smaa`
- 期望：
  - 边缘更干净，且不应出现降级警告。
- 打开：`/?aa=ssaa&aaLevel=1`
- 期望：
  - 画面更干净但更耗，且不应出现降级警告。

### 10.5 IBL 全局强度（Option A）
- 打开：`/?ibl=0.5` / `/?ibl=2.0`
- 期望：
  - PBR 物体 IBL 反射/填充光按比例变化。
- 一致性：反复刷新/切换参数后，材质不会越来越亮/暗（baseline 不漂移）。

### 10.6 Phase 2（照明标定）最低可解释性验证
- 打开：`/?post=raw`
- 期望：
  - bloom/flare/planet glow/atmosphere 不参与，便于专注调光照。
- 调参示例：`/?post=raw&exp=0.9&sun=3.8&amb=0&hemi=0`
- 期望：
  - 降低 `amb/hemi` → 阴影更深。
  - 提高 `exp` → 整体更亮。

---

## 11. 分阶段计划（Informative）

### Phase 0 — 可观测性/调试工具
- 交付：debug view，验证 tone mapping 前存在 >1 HDR 值。

### Phase 1 — 基础管线重构（ESM + ColorSpace + OutputPass）
- 交付：r162 升级 + ColorSpace 迁移 + OutputPass 基线。

### Phase 2 — 照明/IBL 标定
- 交付：收敛 Ambient/Hemisphere；明确 IBL 与主光（太阳）的能量分配。

### Phase 3 — Contact Shadows（优先）→ SSAO/SAO（可选）

> Phase 3 的目标不是“再做一套 shadow map”，而是补齐 HDR/IBL 标定后最显著的缺口：
> **近场接触/细节尺度的遮蔽与层次**（飞船模型更不“发平”、更有贴合感）。
>
> 注：本项目已存在解析几何的“行星遮挡太阳直射光”方案（ray-sphere occlusion，作用于飞船直射光）。
> Phase 3 关注的是另一类问题：飞船自身细节/接触尺度的遮蔽（与行星遮挡互补）。

- 交付：以 Contact Shadows 为 MVP（先解决“平”），再在其上引入可选 SSAO/SAO（解决“细节凹槽/结构遮蔽”）。

#### Phase 3A — Screen-space Contact Shadows（MVP，先做）
- 原理：基于 **深度纹理（DepthTexture）** 重建像素位置，在 **太阳光方向** 做短距离 raymarch（近场可见性近似），得到接触阴影因子。
- 当前实现（已落地，避免“玄学深度/污染行星”）：
  - 专用 ship depth prepass：每帧单独渲一张只包含飞船的 `DepthTexture`（不依赖 composer 内部 depth，确保“有且是本帧”）。
  - 飞船材质注入：在飞船 `MeshStandard/PhysicalMaterial` 的光照末端对 `reflectedLight.directDiffuse/directSpecular` 乘接触阴影因子（只影响太阳直射，不影响 IBL/ambient/hemi）。
  - 输入语义收敛：depth 只包含飞船 → 接触阴影不会“糊”到行星/背景上。
  - 调试输出：`csDebug=1/2` 走全屏替换输出，并强制 `NoToneMapping`（绝对/可解释）。
- 工程前置（必须）：不要把“有 depth buffer”当成“有可采样 depth texture”。
- 约束（必须）：
  - Contact Shadows 只做“接触尺度”（半径/最大距离必须小、强度必须保守），避免退化成“全局发灰 AO”。
  - 只应衰减直射光；否则会把环境光也压暗，导致脏灰/本影内仍可见“阴影变化”。
- 参数与开关（要求）：`ao=contact`、`csDebug`、`csDist/csThick/csStr/csSteps`、`mat=white` 等统一记录在 `docs/debug_url_params.md`。
- 验收（DoD）：
  - 飞船模型在侧光/背光下的结构边缘与细节更有层次，但画面不出现明显灰雾。
  - 相机运动时无明显大面积闪烁/条带（允许少量局部伪影；需可通过减小半径/步数/强度抑制）。
  - `?debug=exposure` 仍能观察到 OutputPass 前存在 >1 HDR 值；不得引入二次 tone mapping。

#### Phase 3B — SSAO/SAO（可选，高质量模式，后做）
- 目标：补齐环境光遮蔽（IBL/ambient/hemi）导致的“凹槽/缝隙不够压”的结构层次。
- 前置条件：Phase 3A 稳定后再引入；否则 AO 的噪声/halo/脏灰会干扰 Phase 2 的照明标定。
- 实现要点：
  - 优先 half-res AO + 边缘保真的 blur/上采样，避免在高 DPR 下成本过高。
  - 法线来源策略需明确：优先显式法线（NormalPass/GBuffer）；若走深度重建法线，需接受质量与伪影 trade-off。
- 当前实现（已落地，ship-only SSAO；不引入额外 gbuffer）：
  - 复用飞船 depth prepass（与 Contact Shadows 共用 DepthTexture 输入）。
  - AO 计算在可调分辨率（`ssaoScale`）的 RT 中进行，并提供可选 depth-aware blur。
  - 仅衰减飞船的间接光（`indirectDiffuse/indirectSpecular`：IBL/ambient/hemi），不影响太阳直射。
  - debug：`ssaoDebug=1` 全屏替换输出（强制 `NoToneMapping`），便于直接观察 AO 因子。
- 默认策略：SSAO/SAO 默认关闭，仅作为可选高质量开关；参数与开关同样记录在 `docs/debug_url_params.md`。
- 验收（DoD）：
  - 细节凹槽/舱段交界更立体，但暗部不糊、不脏、不出现明显 halo。
  - 运动稳定性可接受；不达标则保持默认关闭。

#### 补充：飞船自阴影（ship-only shadow map，太阳直射）
- 目标：提供更“语义正确”的太阳直射自阴影（相比 contact 更接近真实 shadow map），且不污染行星。
- 当前实现（已落地）：
  - `sShadow=1`：专用飞船 shadow depth prepass + 飞船材质注入 compare（仅影响太阳直射，不影响 IBL/ambient/hemi）。
  - 质量控制：tight fit / texel snapping / bias（含 normal/slope）/ 可调软硬与采样数（Poisson rotated PCF）。
  - 参数与推荐组合见：`docs/debug_url_params.md`。

### Phase 4 — Post FX 恢复（HDR 规范化，逐项回归）

> 背景：Bloom / Lens Flare / Atmosphere(Fresnel) / Glow 这些组件早期基于 LDR 习惯实现，
> 直接恢复会把“管线是否正确”“照明是否标定到位”重新搅乱。
>
> Phase 4 的目标是：在 HDR 基线稳定后，按域分离（HDR 域 vs display 域）逐项恢复，并为每个效果建立独立开关与验收标准。

#### Phase 4 前置条件（必须）
- Phase 1/2 的 HDR 基线已稳定：tone mapping 只发生一次（末端 OutputPass），且 HDR 中间缓冲在桌面端可用。
- Phase 3A（Contact Shadows）已稳定：飞船近场层次不再“发平”，且不引入明显脏灰/闪烁。
- `post=raw`（标定模式）长期保留，用于 Phase 2/3 的可重复验证。

#### Full-Post 推荐顺序（规范化目标）
- HDR 域（scene-referred，tone mapping 前）：
  1) Base Render（`RenderPass`/`SSAARenderPass`）
  2) Contact Shadows（如启用；当前实现为飞船材质注入，不是 composer pass）
  3) SSAO/SAO（可选，如启用）
  4) Bloom 提取与模糊（HDR bloom）
  5) Composite（base + bloom）
- 显示域（display-referred）：
  6) AA（`SMAAPass`，如启用）
  7) Output（`OutputPass`）
- 显示域后（镜头/风格化，最后恢复）：
  8) Lens Flare（定位为 display-referred 的镜头伪影）
  9) Film/Grain/CA/Vignette（如启用，默认弱）

#### Phase 4A — Bloom（最先恢复）
- 定位：HDR 管线核心效果，必须在 tone mapping 前工作。
- DoD：
  - `?debug=exposure` 下可证明高亮（>1）区域触发 bloom，低亮区域不应被整体抬亮。
  - `post=raw` 可完全关闭 bloom，不影响 Phase 2 标定路径。

#### Phase 4B — Atmosphere / Fresnel / Glow（第二批恢复）
- 定位：风格化边缘光/辉光（scene 内 ShaderMaterial/Sprite additive），最容易在 HDR 下抬平暗部。
- 规则：必须明确哪些对象参与 BloomLayer（参与则会被 bloom 放大），默认强度必须保守。
- DoD：开启后不应造成“暗面发白、阴影丢结构”，且与 Phase 3A 接触层次互补。

#### Phase 4C — Lens Flare（最后恢复，改为 Post）
- 定位：镜头伪影，应当是 display-referred。
- 实现路线（选定）：将 lens flare 从 scene 内 sprites 迁移为 **OutputPass 之后的 post pass**（更可控、与 HDR/bloom 解耦）。
- DoD：
  - flare 不应成为曝光问题的噪声源；默认不喧宾夺主。
  - bloom 强度变化不应让 flare 失控（与 bloom 解耦）。

#### Phase 4D — Cinematic（可选）
- grain/CA/vignette 等应置于 OutputPass 之后，且默认强度弱；避免干扰 AA 与 HDR 调试。

---

## 12. 实施记录（Implementation Log，Informative）

### 已完成（当前工作区）
1. three r162（无 bundler）：`importmap + <script type="module">`，并桥接 `window.THREE`。
2. ColorSpace API 迁移：`renderer.outputColorSpace`、`texture.colorSpace`。
3. `finalComposer` 末端加入 `OutputPass`（统一 tone mapping + output transform）。
4. Phase 0 debug pass（位于 OutputPass 前）：`?debug=exposure` / `?debug=luma`。
5. Option A：实现全局 `iblIntensity`（`?ibl=`）并保存材质 baseline 防漂移。
6. 修复升级后 shader 注入不兼容导致的编译失败（旧 `vUv` 等变量名）。
7. Phase 2（物理摄影感照明标定）第一步：支持 `?exp`/`?sun`/`?amb`/`?hemi` 并默认降低 fill light。
8. 清理浏览器噪音：`data:,` favicon；避免 texture image 未就绪时强制 `needsUpdate=true`。
9. Phase 3A（飞船 Contact Shadows）：`ao=contact` + 专用 ship depth prepass（DepthTexture），并提供 `csDebug=1/2` 全屏替换调试输出（强制 `NoToneMapping`）。
10. Phase 3B（飞船 SSAO）：`ao=ssao`（ship-only，自研 shader + 复用 ship depth；仅衰减间接光），并提供 `ssaoDebug=1` 调试输出。
11. 飞船太阳直射自阴影：`sShadow=1`（ship-only shadow map depth prepass + shader compare；提供 tight fit/snap、bias、软硬与采样数等参数）。
12. Phase 4A（Bloom 开始解耦）：新增 `bloom=0/1` 独立开关（允许 `post=raw&bloom=1`），并提供 `bloomStr/bloomRad/bloomTh` 调参与 `bloomDebug=1` 全屏替换调试输出。

### 已知问题/观察（非阻塞）
- Firefox 可能对 Google Fonts `Chakra Petch` 报 `maxp: Bad maxZones`（疑似 CDN/缓存导致），不影响渲染逻辑。
- 刷新时出现 WebSocket 断开/重连日志属于正常。

---

## 13. 附录：调试参数文档（Normative Reference）

所有 URL 参数、默认值、范围、推荐组合与解释统一维护在：
- `docs/debug_url_params.md`
