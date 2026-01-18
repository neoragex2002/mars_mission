# Spec：HDR/PBR 渲染管线重构（Three.js r162，桌面优先）

> 本文是对 `docs/issue_hdr_pipeline_rebuild_zh.md` 的“可执行规格书（Spec）”版本，目标是让后续实现过程遵循一致的 HDR/PBR best practice，而不是靠临场调参。

---

## 0. 范围与约束

### 0.1 目标
- 完成一次“结构正确”的 HDR 管线重构：
  - HDR 域（scene-referred / linear / half-float）完成 base render、bloom、合成
  - 显示域（display-referred）完成 tone mapping + 输出色域转换，并接入 AA
  - Cinematic（grain/CA/vignette）作为 **最后显示域 pass**，在 HDR 基础稳定后再接入

### 0.2 平台范围
- 桌面优先：Chrome/Edge/Firefox，WebGL2
- 不保证移动端效果；若不满足要求能力，必须显式降级

### 0.3 three.js 版本与资源
- 目标版本：`three@0.162.0`（r162）
- three/addons：同版本 `three@0.162.0/examples/jsm/...`
- HDRI：默认外链 `venice_sunset_1k.hdr`（debug baseline），必须提供 fallback

### 0.4 重要工程约束
- 不引入构建工具（no bundler）。
- 渲染入口与 three addons 全部改为 ESM import；其它 UI 脚本可逐步迁移。
- 所有外链资源需满足 CORS；失败必须 fallback + 记录。

---

## 1. 关键术语（统一语言）

- **HDR 域 / scene-referred**：线性空间中进行光照与合成，像素值可 > 1。
- **显示域 / display-referred**：将 HDR 映射到 SDR 显示（tone mapping），并做输出色彩空间转换（通常 sRGB）。
- **OutputPass**：r162 的标准输出 pass。用于将 renderer 设置的 tone mapping 与输出色域转换应用到最终结果。
- **ColorSpace**：r162 体系。`Texture.colorSpace` / `renderer.outputColorSpace`。

---

## 2. 目标管线结构（强制）

### 2.1 Pass 顺序（第一阶段固定）
> 第一阶段严格采用 r162 官方示例的 AA→OutputPass 基线顺序。任何 AA 与 OutputPass 顺序调整都属于后续实验，不得与 HDR 基础重构混在同一阶段。

**HDR 域（scene-referred）**
1. Base Render（`RenderPass` 或 `SSAARenderPass` 作为 base render）
2. Bloom（`UnrealBloomPass` 或等效 HDR bloom）
3. Composite（HDR 合成：base + bloom）

**显示域（display-referred）**
4. AA：
   - SMAA 路径（默认）：`SMAAPass`
   - SSAA 路径（高质量）：`SSAARenderPass` 作为 base（见 r162 示例）
5. Output：`OutputPass`

**电影化（延后接入）**
6. CinematicShader：grain/CA/vignette（位于 OutputPass 之后；HDR 管线稳定后再接入）

### 2.2 Tone mapping 策略（强制）
- HDR 域阶段：禁止 tone mapping（必须 NoToneMapping）
- 输出阶段：由 OutputPass 统一执行 tone mapping（baseline：`NeutralToneMapping`）

### 2.3 ColorSpace 策略（强制）
- `renderer.outputColorSpace = THREE.SRGBColorSpace`
- 所有颜色贴图（albedo/baseColor、背景星空贴图等）必须显式标注为 `SRGBColorSpace`
- 所有数据贴图（normal/roughness/metalness/AO/height 等）必须保持 `NoColorSpace`（默认）

---

## 3. ESM 迁移规格

### 3.1 `index.html` 结构
- 使用 `<script type="importmap">` 声明：
  - `three` → `https://unpkg.com/three@0.162.0/build/three.module.js`
  - `three/addons/` → `https://unpkg.com/three@0.162.0/examples/jsm/`
- 使用 `<script type="module">` 作为渲染入口。

### 3.2 桥接策略（第一阶段允许）
- 第一阶段允许将 ESM 导入的 three/addons 挂到 `window.THREE`，以便 legacy 脚本继续运行。
- 但所有 three/addons 必须来源于同一版本（r162），禁止混用。

---

## 4. ColorSpace 迁移规格（针对本项目）

### 4.1 必须替换/删除的 legacy API
- 删除任何对以下符号的依赖：
  - `THREE.sRGBEncoding`
  - `THREE.LinearEncoding`
  - `renderer.outputEncoding`
  - `texture.encoding`

### 4.2 替换对照表（已核实）
- `renderer.outputEncoding = THREE.sRGBEncoding` → `renderer.outputColorSpace = THREE.SRGBColorSpace`
- `texture.encoding = THREE.sRGBEncoding` → `texture.colorSpace = THREE.SRGBColorSpace`
- `texture.encoding = THREE.LinearEncoding` → `texture.colorSpace = THREE.LinearSRGBColorSpace`
- data textures（normal/roughness/metalness/AO）保持 `texture.colorSpace = THREE.NoColorSpace`

---

## 5. HDR RenderTarget 与能力检测规格

### 5.1 强制能力要求（桌面优先）
最低要求：
- WebGL2
- 支持 HalfFloat color buffer（`EXT_color_buffer_float` 或 `EXT_color_buffer_half_float`）

### 5.2 行为要求
- 若满足要求：启用 HDR 管线（HalfFloat RT）
- 若不满足：显式降级到 LDR 管线（并输出明确提示）

---

## 6. 环境（IBL）与背景（星空）规格

### 6.1 强制解耦
- `scene.environment`：仅用于 IBL（PMREM 后的 env map）
- `scene.background`：保持现有星空/nebula（LDR/procedural），不要用 venice HDRI 替代

### 6.2 全局 IBL 强度（Option A，已确定）
- 由于 r162 不提供 `scene.environmentIntensity`，必须引入一个应用层 `iblIntensity` 概念。
- 本项目选择 **Option A**：集中管理场景内 PBR 材质的 `envMapIntensity`（按 `iblIntensity` 统一缩放）。
- 约束：必须把每个材质的“基准 envMapIntensity”保存下来（例如 `material.userData.baseEnvMapIntensity`），避免重复叠乘导致数值漂移。

---

## 7. Debug/可观测性（Phase 0）规格

### 7.1 必须实现的 debug 模式
- `?debug=exposure`：false-color 过曝分段（阈值：>=1、>=2、>=4、>=8）
- `?debug=luma`：亮度灰度视图

### 7.2 采样位置要求
- debug pass 必须插入在 OutputPass 之前，观察 HDR 域（scene-referred）的数值。

---

## 8. 浏览器侧验证 Checklist（第一阶段）

> 目的：把“是否真的按 spec 工作”变成可重复验证的步骤，避免靠主观感觉。

### 8.1 启动与基础连通
- 启动：`./start.sh`
- 打开：`http://localhost:<PORT>/`
- 期望：
  - 页面正常加载，无白屏。
  - 控制台无 three.js shader compile/link error。
  - WebSocket 最终能显示 `connected`（刷新时出现 disconnect/connected 属于正常）。

### 8.2 贴图与材质（ColorSpace 基线）
- 打开：`/?aa=none`
- 期望：
  - 地球/火星贴图可见（day map、mars diffuse）。
  - 控制台不应出现因 `onBeforeCompile` 注入导致的 `vUv undeclared` 等错误。

### 8.3 Debug：HDR 值可观测（Phase 0）
- 打开：`/?debug=exposure`
- 期望：
  - 画面变为 false-color（可见 >=1、>=2、>=4、>=8 的分段）。
  - 太阳/发光体附近出现高亮分段，证明 tone mapping 前存在 >1 的 HDR 值。
- 打开：`/?debug=luma`
- 期望：
  - 画面为亮度灰度视图（线性亮度观测）。

### 8.4 AA：SMAA / SSAA 两条路径
- 打开：`/?aa=smaa`
- 期望：
  - 边缘更干净，性能开销相对小。
  - 不应出现 “SMAAPass unavailable” 的降级警告。

- 打开：`/?aa=ssaa&aaLevel=1`
- 期望：
  - 画面更干净但明显更耗。
  - 不应出现 “SSAARenderPass unavailable” 的降级警告。

### 8.5 IBL 全局强度（Option A）
- 打开：`/?ibl=0.5`
- 期望：
  - PBR 物体（飞船、行星 PBR 材质）整体 IBL 反射/填充光变弱。

- 打开：`/?ibl=2.0`
- 期望：
  - 同样对象 IBL 反射/填充光增强。

一致性要求：
- 反复刷新或切换参数后，材质不会“越来越亮/越来越暗”（baseline 未漂移）。

### 8.5.1 IBL 环境色（用于排查偏色）
- 目的：将 IBL 的“色调”与背景（星空/星云）解耦，快速验证是否存在 IBL 带来的蓝紫偏色。
- 打开：`/?post=raw&bg=off&iblEnv=neutral&ibl=1&debug=luma`
- 期望：
  - IBL 填充仍存在（`ibl=1`），但色偏显著减弱（更接近中性灰）。
  - 与 `/?post=raw&bg=off&iblEnv=default&ibl=1` 对比，阴影抬升更“干净”，不再明显偏蓝/偏紫。

### 8.5.2 深空 IBL（低频银河 + 太阳反射瓣）
- 打开：`/?post=raw&bg=off&iblEnv=space&ibl=1&debug=luma`
- 期望：
  - 阴影不被明显抬平（黑位仍然接近黑）。
  - 金属表面能看到更“自然”的环境反射高光层次，但不会出现明显蓝紫偏色。

### 8.6 Phase 2（物理摄影感照明）快速验证
- 打开：`/?post=raw`
- 期望：
  - bloom/flare/planet glow/atmosphere 不参与，便于专注调光照。
  - 夜面更暗，层次更强（不再被 ambient/hemi 大幅抬平）。

- 调参示例：`/?post=raw&exp=0.9&sun=3.8&amb=0.03&hemi=0.03`
- 期望：
  - exposure/主光/补光变化是可解释的：降低 `amb/hemi` 会让阴影更深；提高 `exp` 会整体抬亮。

### 8.7 背景与夜灯调试
- 背景（星光/星云）开关：
  - 关闭背景：`/?bg=off`
  - 背景变暗：`/?bg=dim`
- 地球夜灯强度：`/?city=0.3`（更弱） / `/?city=1.0`（默认） / `/?city=1.6`（更强，建议仅对比用）

推荐调试组合：
- `/?post=raw&bg=off&debug=exposure`（纯光照/曝光标定）
- `/?post=raw&bg=dim&city=0.3`（保留少量背景但不干扰夜面）

### 8.8 Console 噪音检查
- 期望：
  - 不再出现 `/favicon.ico 404`（已使用 `data:,` icon）。
  - `Texture marked for update but no image data found` 警告显著减少/消失。
  - 字体警告（Firefox Chakra Petch）可忽略，但应记录为可选优化项。

---

## 9. 已实现进展（与 spec 对齐）

### 已落地内容（当前工作区）
- three r162：`importmap + <script type="module">`，并桥接 `window.THREE`。
- ColorSpace API 迁移：renderer/texture 使用 `outputColorSpace` 与 `texture.colorSpace`。
- OutputPass：加入 `finalComposer` 末端。
- Debug pass：`?debug=exposure` / `?debug=luma`，位于 OutputPass 前。
- `iblIntensity` Option A：`?ibl=`，集中管理 PBR 材质 `envMapIntensity`，保存 baseline 防漂移。
- Phase 2（物理摄影感照明）第一步：支持 `?exp`/`?sun`/`?amb`/`?hemi` 并默认降低 fill light。

### 升级后遇到的问题与处理
- r162 升级导致 `onBeforeCompile` 注入的旧 shader 变量名不兼容（`vUv` / `emissiveMapTexelToLinear` 等），引发 Shader 编译失败并表现为“贴图不显示”。已按 r162 chunk 的命名修复。
- r162 对“贴图 needsUpdate 但 image 未加载”的情况更敏感，浏览器 console 会提示 `Texture marked for update but no image data found`。已避免在 `texture.image` 未就绪时强制 `needsUpdate=true`。

---

## 10. 下一阶段（未开始）
- HDR RT 强约束（HalfFloat 不满足则显式降级）
- HDR Bloom/Composite 的域划分与参数标定
- 光照能量分配重建（ambient/hemi 收敛，主光与 IBL 关系标定）
- AO/Contact shadow
- CinematicShader 作为末端显示域 pass 的重新接入（延后）
