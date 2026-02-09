# 地球两层壳大气系统改进实施方案（Atmosphere Layer + Halo Layer Thin Shell）

> 目标：把“晶莹感 / 边缘透光（Translucency）/ 向宇宙外溢柔光（Bloom 扩散）”做得稳定、可调、可验收。

**日期**：2026-02-09  \
**范围**：仅覆盖地球相关的两层壳（大气层 + 光晕层），不引入新依赖，不做体积光线步进（Volumetric Raymarching）。

---

## 0) 先把话说死：统一术语与对外参数键

后文只使用两层壳术语（避免 atmo/halo 混说）：

### 0.1 大气层（Atmosphere Layer）
- **定位**：贴地薄壳，负责“内润、透光、边缘变蓝、黄昏带”。
- **对外参数键**：`atmo` / `atmoStr` / `atmoBloom`

### 0.2 光晕层（Halo Layer）
- **定位**：外层薄壳，负责“外发光能量分布”，主要用于喂 Bloom 生成“向宇宙扩散的柔光”。
- **对外参数键（统一为 halo*）**：`halo` / `haloStr` / `haloBloom`

### 0.3 Bloom（后处理）
- **定位**：把高亮输入源扩散成柔光（你要的“延伸到宇宙”的关键）。
- **对外参数键**：`bloom` / `bloomStr` / `bloomRad` / `bloomTh`

---

## 1) 分工与“谁负责喂 Bloom”（必须统一口径）

这件事只看一个事实：**进入 `BLOOM_LAYER` 的对象才会喂 Bloom**。

### 1.1 机制事实（当前工程的 Bloom 输入规则）
- 大气层是否喂 Bloom：由 `atmoBloom` 决定（`atmosphere.layers.enable(BLOOM_LAYER)`）。
- 光晕层是否喂 Bloom：由 `haloBloom` 决定（薄壳 mesh，通过 `layers.enable(BLOOM_LAYER)`）。

### 1.2 设计分工（我们要达成的“标准做法”）

| 层 | 主要职责 | 是否直接在 base render 可见 | 是否建议作为主要 Bloom 输入源 |
|---|---|---:|---:|
| Atmosphere Layer | 贴地透光、边缘蓝、黄昏带 | 是（需要） | 否（可选辅助） |
| Halo Layer | 外发光能量分布、给 Bloom 扩散 | **不一定**（推荐 Bloom-only） | **是（主路线）** |

一句话总结：
- **Atmosphere Layer = 内润（可见，但不一定喂 Bloom）**
- **Halo Layer = 外发光（主要喂 Bloom；建议 Bloom-only 避免“铁圈本体”）**

---

## 2) 现状诊断（为什么现在像“铁圈”）

### 2.1 Atmosphere Layer（现状）
- 当前是 `ShaderMaterial + BackSide + depthWrite=false + additive` 的贴地薄壳。
- 视觉问题通常来自参数：
  - `intensity/hazeStrength` 偏大 → 像“蓝色塑料膜”
  - `rimPower` 偏低 → 边缘不够集中、球心不够透

### 2.2 Halo Layer（现状问题根因）
- 当前实现是 `THREE.Sprite + 径向渐变贴图`。
- 这种形态被地球遮挡后天然呈现“外沿一圈亮”，它的视觉上限就是“光圈/铁圈”。

**结论**：如果你要“向宇宙扩散的柔光”，Halo Layer 必须从 Sprite 升级为**外层薄壳 Mesh（Thin Shell）**，并把“扩散”主要交给 Bloom。

---

## 3) To-Be 总体方案（两层壳 + 薄壳 Halo + Bloom 协同）

### 3.1 几何结构（洋葱皮 / Onion Skin）
- 地球地表（Surface）
- 云层（Clouds，已有）
- **大气层（Atmosphere Layer）**：半径 `R_atmo = R_surface * 1.02`（贴地薄壳）
- **光晕层（Halo Layer）**：半径 `R_halo = R_surface * 1.06 ~ 1.10`（更外、薄壳）

建议增加 `renderOrder` 稳定透明层叠（防止偶发排序抖动）：
- Surface: 0
- Clouds: 1
- Atmosphere Layer: 2
- Halo Layer: 3

### 3.2 材质策略（HDR/Bloom 友好）
- 两层壳都遵循：
  - `transparent=true`
  - `depthWrite=false`
  - `toneMapped=false`（保持 scene-referred 线性，交给 OutputPass/最终链路）
- Atmosphere Layer：偏“薄、透、集中边缘”。
- Halo Layer：偏“软、宽、弱本体 + 强 Bloom 扩散”。

### 3.3 Bloom-only Halo（核心策略，解决“铁圈本体”）

当满足以下条件时：
- `halo=1`（Halo Layer 开启）
- `haloBloom=1`（Halo Layer 进入 Bloom layer）
- `bloom=1`（Bloom pass 实际启用）

则把 Halo Layer 设置为 **Bloom-only**：
- `halo.layers.set(BLOOM_LAYER)`（只在 Bloom render 可见）
- base render（layer 0）不直接画 halo 本体，只通过 Bloom 合成得到“向宇宙扩散”的柔光。

这条策略能从根上避免“我关掉 Bloom 时看到一圈贴纸”的问题。

---

## 4) 实施计划（分阶段，先形态后物理感）

> 原则：每个阶段都能独立验收；不一次性引入太多不确定性。

### Phase 0：建立固定验收口径（先统一观察方式）

**A) 只看 base（不让 Bloom 干扰形态）**
- `/?post=raw&bloom=0&atmo=1&halo=0&ibl=0&amb=0&hemi=0`

**B) 只看 Halo Layer 驱动 Bloom 外扩（主路线）**
- `/?post=raw&bloom=1&bloomTh=1.0&bloomRad=0.6&bloomStr=1.2&atmo=1&atmoBloom=0&halo=1&haloBloom=1&haloStr=0.8`

**C) 检查双重溢光（通常不建议长期这么开）**
- `/?post=raw&bloom=1&atmo=1&atmoBloom=1&halo=1&haloBloom=1`

验收截图建议固定 3 个视角：
- 正对球心（看“透不透”）
- 看边缘（看“边缘集中度/水晶壳”）
- terminator 附近（看“夜侧干净/黄昏带自然”）

### Phase 1：大气层参数收敛（不动 shader 结构）

**目标**：让 Atmosphere Layer 更像“气体”而不是“蓝膜”。

**改动点**（`frontend/main.js` 的地球 `atmospherePreset`）：
- 降低整体浓度：降低 `intensity`、降低 `hazeStrength`。
- 提高边缘集中：显式覆盖 `rimPowerNear/rimPowerFar`（让蓝只集中在极边缘）。
- 颜色偏“平流层蓝”：减少发绿（rim/haze）并保留适度暮光暖色（twilight）。

**建议初值（第一轮）**
- `intensity`: 0.35~0.55
- `rimPowerNear`: 6.0~7.5
- `rimPowerFar`: 4.0~5.5
- `hazeStrength`: 0.03~0.08
- `twilightWidth`: 0.12~0.18
- `twilightStrength`: 0.35~0.60

**验收**：用 Phase 0 的 URL A。

### Phase 2：光晕层从 Sprite 替换为薄壳 Halo（核心变更）

**目标**：让 Halo Layer 具备“柔和外扩”的潜力，并成为 Bloom 的主输入源。

**改动点**（`frontend/main.js`）：
1) 删除/替换 `THREE.Sprite` 的 Halo Layer 创建。
2) 新增 `createHaloMaterial()`（专用 halo shader）。
3) 新增 Halo mesh：`new THREE.Mesh(new THREE.SphereGeometry(R_halo, 64, 64), haloMaterial)` 并挂到地球 group。
4) 复用 Atmosphere 的 sunDirection/cameraFactor 更新逻辑，给 Halo Layer 同样更新 uniform。
5) 实施 Bloom-only Halo 策略（见 3.3）。

**Halo shader（第一版，保持简单但有效）**
- 输入：`sunDirection`、`cameraFactor`、`haloStrength(=haloStr)`、`haloTint(常量/preset)`
- 计算：
  - `rim = pow(1 - |N·V|, haloRimPower)`（haloRimPower < atmo rimPower，越软越宽）
  - `day = smoothstep(a, b, N·L)`（夜侧干净）
  - `halo = rim * day`（可加轻微 terminator 窄带作为可选项）
- 输出：加色叠加（One+One），`depthWrite=false`。

**验收**：Phase 0 的 URL B。

### Phase 3：大气层“物理感升级”（Rayleigh/Mie 近似；仍是薄壳）

> 这是你问的 Rayleigh/Mie：建议实施，但在 Halo 薄壳跑通之后再做，避免多变量叠加调不清。

**目标**：让 Atmosphere Layer 具备更接近真实的层次：
- **Rayleigh（瑞利）**：宽、偏蓝（空气本色）
- **Mie（米氏）**：窄、更亮、略偏白/偏暖（前向散射/辉光感）

**实现约束（防止参数爆炸）**
- 不新增 URL 参数键。
- 仍只用 `atmoStr` 作为总强度旋钮。
- Rayleigh/Mie 的比例、幂指数作为地球 preset 常量（必要时通过 `cfg=` 覆盖，而不是新增 URL 键）。

**建议实现方式（在现有 `createAtmosphereMaterial()` 中升级）**
1) 保留现有 rim（把它视作 Rayleigh 的主形态基底）。
2) 新增 Mie 项（廉价前向散射近似）：
   - `cosVL = clamp(dot(V, L), 0..1)`（视线方向与太阳方向接近时更亮）
   - `miePhase = pow(cosVL, miePower)`（miePower 通常 6~16）
   - `mie = miePhase * rimNarrow * dayMask`（mie 应更窄，可用 `pow(rim, mieRimPower)` 收窄）
3) 合成：
   - `color = rayleighColor * rayleigh + mieColor * mie + twilightTerm + hazeTerm`
4) 继续确保：夜侧干净（所有项都乘 day-mask 或 terminator 窄带）。

**验收**：Phase 0 的 URL A（先 bloom=0 调大气层本体），再在需要时开 `atmoBloom=1` 看与 Bloom 的协同。

---

## 5) 对外参数（收敛版，作为最终契约）

> 原则：只保留“开关 + 强度 + 是否喂 Bloom”。细节（rimPower/颜色/比例）全部属于 preset 常量。

### 5.1 Atmosphere Layer（大气层）
- `atmo`：开关（`auto|1|0`）
- `atmoStr`：强度（`0..6`，默认 1.0）
- `atmoBloom`：是否进入 Bloom layer（`auto|1|0`）

### 5.2 Halo Layer（光晕层）
- `halo`：开关（`auto|1|0`；建议默认 off）
- `haloStr`：强度（`0..6`；常用 0..2）
- `haloBloom`：是否进入 Bloom layer（`auto|1|0`；建议主路线）

### 5.3 Bloom（后处理）
- `bloom`：开关（`auto|1|0`）
- `bloomStr`：强度（建议 0.6..1.6）
- `bloomRad`：半径（建议 0.45..0.75）
- `bloomTh`：阈值（建议 0.9..1.2）

### 5.4 明确禁止（防止参数膨胀）
- 不新增历史别名键（对外参数已统一为 `halo*`）。
- 不把 `rimPower/intensity/twilightWidth/RayleighRatio/MiePower` 全部暴露成 URL 参数。
- 高级调参优先走 `?cfg=xxx.cfg` 的 JSON 覆盖。

---

## 6) 风险与对策

### 6.1 Z-fighting / 边缘闪烁
- 通过半径拉开（1.02 vs 1.08）优先解决；必要时再考虑 `polygonOffset`。

### 6.2 Halo 仍像圈
- 必须 Bloom-only（见 3.3）。
- haloRimPower 降低（更软更宽）+ day-mask 门控（夜侧干净）。

### 6.3 Terminator 漏光
- Atmosphere 与 Halo 两者都必须有 day-mask；黄昏带必须是“窄带项”，不能用全局 haze 兜底。

### 6.4 Bloom 过曝变白
- 用 `bloomTh` 提高阈值、用 `bloomRad` 控半径、用 `bloomStr` 控能量。
- Halo 本体不要用超高亮（让 Bloom 扩散去做“软”）。

---

## 7) 验收清单（Review Gate）

- [ ] `post=raw&bloom=0`：大气层球心通透、边缘集中、夜侧干净。
- [ ] `bloom=1&haloBloom=1`：出现明显“向宇宙扩散的柔光”，且不是硬圈。
- [ ] `atmoBloom=1` 仍可控：不会把整圈边缘糊成一坨。
- [ ] 无明显透明排序闪烁/破面。
- [ ] 性能可接受：仅新增一个 sphere mesh + 轻量 shader。
