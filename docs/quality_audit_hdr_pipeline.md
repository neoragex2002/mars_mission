# 质量核查 - HDR/PBR 管线 + 文档/代码一致性（工作区）

> 目的：将当前工作区的 review 结果沉淀为一份具体、可重复执行的 QA 核查清单。
>
> 范围：仅覆盖当前本地修改（git diff）+ 新增/未跟踪资源（untracked assets）。
> 日期：2026-01-22

---

## 1) 变更内容（清单）

### 1.1 修改的文件（git diff）
- `README.md`
- `docs/debug_url_params.md`
- `docs/hdr_pipeline_rebuild_r162.md`
- `frontend/main.js`

### 1.2 新增/未跟踪目录（未加入 git index）
- `frontend/assets/models/`
- `frontend/assets/textures/earth/8k/`
- `frontend/assets/textures/mars/4k/`
- `frontend/assets/textures/mars/8k/`
- `frontend/assets/textures/stars/`
- `frontend/assets/textures/sun/`
- `frontend/assets/textures/unknown/`

备注：
- 代码运行时对资源的引用目前指向 `/static/assets/...` 路径（例如 `frontend/main.js:149`），仓库也已经在 `frontend/assets/textures/...` 下跟踪了其中一部分。
- 如果这些新目录是有意引入的（高分辨率替换资源），请确认它们要么被代码/文档引用，要么保持不入库，以避免仓库体积意外膨胀。

### 1.3 已执行的自动化检查
- `python3 test.py` => PASS (4/4)。该检查验证了基础 Python 依赖与前端文件存在性，但**不验证**浏览器侧 HDR 正确性（后处理链 / 色彩管理）。
- `node --check frontend/main.js` => PASS（仅 JS 语法检查）。

---

## 2) Review 结论（概要）

### 2.1 高风险 HDR 合规性关注点（需要浏览器侧验证）
- 当前 pass 顺序为 `... -> OutputPass -> Cinematic -> OutputDither`（见 `frontend/main.js:2471-2494`）。
- 取决于 r162 中 `OutputPass` + `EffectComposer` 对输出变换（output transform）的管理方式，这可能会 **意外破坏** “最终显示变换必须位于末端（final display transform is last）” 的规则（tone mapping / 输出色域转换可能不再是“真正最后写屏”的一步）。
- 这是最值得优先验证的一项，因为它可能在无明显报错的情况下，让 HDR 基线与所有调试阈值悄然失效。

### 2.2 新增 `cine` 功能的文档/代码一致性
- 文档与代码在以下点上是一致的：
  - 默认关闭
  - `?cine=1` 显式开启
  - `debug!=none` 时强制关闭
  - cinematic 被视作显示域（display-domain）效果

---

## 3) 发现问题清单（按严重级别排序）

> 严重级别定义：
> - P0：可能让 HDR 基线失效，或导致色彩管线错误。
> - P1：较可能为逻辑/文档不一致或缺少可观测性，可能引发未来回归。
> - P2：质量/安全/风格类问题，风险较低。

### P0-1：OutputPass 不是最终写屏的 pass（可能存在显示变换缺口）

**描述**
- 在 `frontend/main.js` 中，链路可能变为：
  - `RenderPass/SSAARenderPass` ->（HDR passes）-> `SMAAPass` -> `DebugPass?` -> `OutputPass` -> `CinematicShader` -> `OutputDitherShader`
- 当启用 `Cinematic` 或 `Dither` 时，**最后一个向默认 framebuffer 写入的 pass 并不是 OutputPass**。

**为什么有风险**
- 对于 three r162 的“规范化 HDR 管线”（normalized HDR pipeline）而言：
  - scene-referred 的 passes 应该运行在“线性 HDR”的中间目标上
  - display-referred 的变换（tone mapping + 输出色域/传递函数转换）必须且只能发生一次，并且必须位于最终末端
- 如果 `OutputPass` 不再是最后一步，那么必须 100% 明确并可验证：
  - tone mapping 发生在何处
  - sRGB（或其他显示传递函数）转换发生在何处
  - 当 Cinematic/Dither 运行时，中间 buffer 处于什么 color space / 显示域状态

**证据**
- `frontend/main.js:2471` 添加了 `OutputPass`
- `frontend/main.js:2478` 在 `OutputPass` 之后添加了 `CinematicShader`
- `frontend/main.js:2487` 在 `OutputPass` 之后添加了 `OutputDitherShader`（若启用 cinematic 则位于其之后）
- `docs/hdr_pipeline_rebuild_r162.md:83-109` 规范性（normative）地要求“末端单次 tone mapping + output transform”

**需要验证项（浏览器侧）**
1) 视觉对比：
   - baseline：`/?aa=none`
   - 开 cine：`/?aa=none&cine=1`
   - raw：`/?post=raw&cine=1`（由于 post=raw 隐含 debug-like baseline，cine 应为关闭；请确认实际行为）
2) 验证“最终帧是否被正确编码（encoded correctly）”：
   - 若条件允许，使用已知的中灰/近黑测试场景；或临时绘制一个 0.18 灰度的 quad，并与预期 sRGB 值对比。
3) 调试阈值自洽性：
   - `/?debug=exposure` 应反映 tone mapping 之前的 HDR 值；开启/关闭 cine 不应改变该 debug 输出。

**建议修复路径（二选一）**
1) 让 OutputPass 真正位于末端：
   - 将 Cinematic/Dither 合并进一个自定义 shader，并把它集成到最终输出阶段（等价于“把 cine/dither 做成最终输出的一部分”），或
   - 构建一个“FinalDisplayPass”，在一个 shader 中完成：tone mapping + output transform + cine + dither，并让它成为最后一个 pass。
2) 保持当前顺序，但把规则变得明确且鲁棒：
   - 确认 `OutputPass` 之后的 buffer 已经是 *display-ready*（包含正确的输出编码/变换），并且
   - 让 Cinematic/Dither 明确在该显示域中工作，避免“意外二次编码”或“漏编码”。
   - 如果选择这条路线，需要在 `docs/hdr_pipeline_rebuild_r162.md` 中把它写成规范性规则，并补充可重复验证步骤。

状态：需要验证（浏览器侧）。

---

### P1-1：文档规范要求 “HDR 域 NoToneMapping”，但实现依赖 `material.toneMapped=false`

**描述**
- 文档写明：“HDR 域阶段：禁止 tone mapping（必须 NoToneMapping）”（`docs/hdr_pipeline_rebuild_r162.md:101-104`）
- 代码实际设置为：
  - `renderer.toneMapping = THREE.NeutralToneMapping`（`frontend/main.js:2067`）
  - 并通过 `applyHdrMaterialPolicy()` 将多数材质强制设为 `toneMapped=false`（`frontend/main.js:3753-3786`）

**风险**
- 如果能够保证在任何 HDR 域渲染发生之前，所有场景材质都已被设置为 `toneMapped=false`，那么这套实现通常是可工作的。
- 但这属于“文档/实现不一致”，会变得脆弱：
  - 未来新增的 mesh/material 若没有经过 `applyHdrMaterialPolicy()`，可能会重新引入“过早 tone mapping”。
  - 按文档理解，reviewer 会默认 HDR passes 期间 renderer 处于 `NoToneMapping`，但代码并非如此。

**建议**
- 二选一：
  1) 修改文档措辞：将“材质层面强制 toneMapped=false”纳入允许/推荐的实现方式；或
  2) 修改实现以匹配文档：在 HDR passes 期间强制 `renderer.toneMapping = NoToneMapping`，并只在最终输出阶段应用 tone mapping。

状态：需要统一规范/实现（SPEC/IMPLEMENTATION ALIGNMENT REQUIRED）。

---

### P1-2：HDR 能力降级是静默的（缺少可观测性）

**描述**
- 代码检查 WebGL2 + float buffer extension，并在可用时使用 `HalfFloatType`（`frontend/main.js:2303-2311`）。
- 当不支持时，会静默回退到 `UnsignedByteType`，这会实质性降低 HDR headroom。

**风险**
- 这会造成“误以为在 HDR 管线里”的错觉。
- 同时也会削弱回归定位能力（例如“为什么这台机器 bloom 看起来很 LDR？”）。

**建议**
- 增加一次性的明确日志与/或 UI 标记：
  - 例如：`console.info('[HDR] using HalfFloat render targets')` vs `console.warn('[HDR] falling back to UnsignedByte (LDR)')`
- 可选：暴露 `window.__mm_hdrMode` 便于快速核查。

状态：缺少可观测性（MISSING OBSERVABILITY）。

---

### P1-3：`cine` 参数解析是宽松容错的；文档表述更像严格枚举

**描述**
- 文档：`cine=auto|1|0`（`docs/debug_url_params.md:358-360`）
- 代码：除 `0/off/false/none` 外的任何值均会开启（`frontend/main.js:1559-1577`）

**风险**
- 这不是功能性 bug，但属于 QA 层面的“规范 vs 实现”陷阱（例如“为什么 cine=foo 也会开启？”）。

**建议**
- 二选一：
  - 更新文档：“除显式关闭值外，其它值均视为开启”；或
  - 改为严格解析：仅 `1/on/true` 视为开启；无效值走 fallback。

状态：需要决定“规范/实现偏好”（SPEC/IMPLEMENTATION PREFERENCE DECISION）。

---

### P2-1：`applyHdrMaterialPolicy()` 记录 baseline 但未使用

**描述**
- 记录了 `material.userData.mmToneMappedBaseline`，但其它位置未引用（`frontend/main.js:3762-3766`）。

**风险**
- 风险较低，但会制造“似乎可以恢复 baseline”的暗示，而实际上没有恢复路径。

**建议**
- 要么删除 baseline 记录逻辑，要么补齐“恢复路径”（用于 LDR fallback / 对象例外处理）。

状态：可选清理项（CLEANUP OPTIONAL）。

---

## 4) 文档/代码一致性核对清单（需确认项）

### 4.1 新增 `cine` 功能（文档 <-> 代码）
期望：
- 默认关闭（`docs/debug_url_params.md:358-360`、`README.md:191`）
- `?cine=1` 开启（`frontend/main.js:1559-1577`、`frontend/main.js:2478`）
- `debug!=none` 时强制关闭（`docs/debug_url_params.md:358-360`、`frontend/main.js:2478`）

手工验证 URL：
- `/?cine=1`
- `/?debug=exposure&cine=1`（cine 不应生效；debug 输出不应被“污染”）

### 4.2 管线顺序描述
- 文档顺序包含 `OutputPass` -> Cinematic -> Dither（`docs/hdr_pipeline_rebuild_r162.md:83-109`）。
- 代码与该顺序一致（`frontend/main.js:2471-2494`）。

重要：只有在“真正的输出边界”仍保持正确的 display transform 时，这个顺序才算“正确”。详见 P0-1。

---

## 5) HDR 管线规范化核查清单（实操）

### 5.1 色彩管理（Color management）
确认：
- 设置了 `renderer.outputColorSpace = THREE.SRGBColorSpace`（`frontend/main.js:2066`）。
- 所有 albedo/baseColor 颜色贴图为 `SRGBColorSpace`（通过 `registerColorTexture()`，见 `frontend/main.js:3671-3707`）。
- 所有数据贴图（normal/roughness/ao 等）保持 `NoColorSpace`（通过 `registerDataTexture()`，见 `frontend/main.js:3682-3699`）。

手工检查：
- 检查 Earth/Mars：albedo 观感应正常（不应出现 colorSpace 错误常见的“发白/过暗”）。
- 若存在 `textureColorMode` 的切换（debug 功能），切换后行为应符合预期。

### 5.2 Tone mapping 的“末端单次应用”
确认（规范性意图）：
- HDR 域 passes 不发生 tone mapping。
- tone mapping 只在末端发生一次。

手工检查：
- `/?debug=exposure` 在高亮区域附近必须能显示 >1 的 HDR 值，证明 tone mapping 没有在 debug 前发生。
- Bloom 应对 HDR 能量敏感，而不应表现为 LDR 的“整体白一层（white wash）”。

### 5.3 HDR 中间 RenderTarget
确认：
- 桌面 WebGL2 + float buffer extension 可用时使用 HalfFloat targets。
- 否则需要明确日志/标记为 LDR fallback。

手工检查：
- 如实现允许，可在控制台检查 composer 内部 RT type（依赖具体实现）：
  - 确认使用的是 `HalfFloatType` 还是 `UnsignedByteType`。

### 5.4 显示域（艺术向）passes 的摆放
确认设计选择：
- Cinematic（grain/CA/vignette）属于显示域（display-domain）。
- Dither 位于末端。

但同时必须确保：
- 最终写屏输出只被正确编码一次（不漏编码、不二次编码）。

---

## 6) “物理向 vs 艺术向”分类（用于校准模式）

### 偏物理 / 工程近似（适合做 HDR 基线校准）
- PBR materials + IBL via PMREM (`frontend/main.js:2160-2260`)
- Global IBL intensity scaling with baseline preservation (`frontend/main.js:1900-1936`)
- Bloom in HDR domain + additive composite (`frontend/main.js:2340-2440`, `frontend/main.js:150-204`)
- Contact shadow / SSAO as indirect-occlusion aids (approximate but useful for structure)

### 明确艺术向 / 镜头风格
- `CinematicShader` (grain/CA/vignette + color bias) (`frontend/main.js:10-55`)
- Lens flare post pass (`frontend/main.js:58+`, enable path in `frontend/main.js:2437-2449`)
- Glow sprites / atmosphere rim effects (scene decoration, can lift shadows if overused)

建议：
- 提供/维护一个“校准预设 URL”，用于一键关闭所有艺术向层：
  - 例如：`/?post=raw&bloom=0&flare=0&sunGlow=0&glow=0&atmo=0&cine=0`

---

## 7) 建议的后续动作（若要让审计闭环）

1) 决定并写清“最终显示变换”的规则：
   - 要么 OutputPass 严格位于末端；要么给出经过验证且文档化的替代方案。
2) 增加明确的 HDR/LDR 模式日志 + 便于运行时检查的 flag（`window.__mm_hdrMode`）。
3) 决定 `cine` 参数是严格解析还是宽松容错，并让文档与实现保持一致。
4)（可选）加入一个小的“校准场景模式”（gray card / step wedge），用于快速 HDR 验证。
