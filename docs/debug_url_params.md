# 调试开关（URL Query Params）

本项目支持通过 URL query string 调参，用于：
- 渲染管线/HDR 调试
- 光照基线标定（物理摄影感）
- IBL（环境反射/填充）对比
- 背景与夜灯强度对比
- 画面抗锯齿/后处理路径切换
- 行星遮挡太阳直射（飞船材质解析遮挡）

默认入口：`http://localhost:<PORT>/`

说明：
- 所有参数都写在 `?` 后，通过 `&` 连接。
- 未指定参数时使用默认值。
- 大多数参数会做容错：非法值会回退到默认值。

---

## 1. 快速组合（推荐）

### 1.1 光照标定（尽量去掉干扰项）
- `/?post=raw&bg=off&debug=luma`

### 1.2 只看太阳直射（极端标定）
- `/?post=raw&bg=off&amb=0&hemi=0&ibl=0`

### 1.3 IBL 偏色排查
- `/?post=raw&bg=off&ibl=1&iblEnv=neutral&debug=luma`

### 1.4 深空 IBL（低频银河 + 太阳反射瓣）
- `/?post=raw&bg=off&ibl=1&iblEnv=space&debug=luma`

### 1.5 飞船行星遮挡（解析遮挡，硬边）
- `/?post=raw&bg=off&ps=1&amb=0&hemi=0&ibl=0`

### 1.6 刷新后保持 Warp 速度（UI 必须匹配）
- `/?speed=0.5` 或 `/?warp=0.5`

### 1.7 只看飞船 Contact AO（白模基准）
- `/?post=raw&bg=off&mat=white&ao=contact&amb=0&hemi=0&ibl=0`

### 1.8 飞船自阴影（推荐替代 contact 做“正确自阴影”）
- `/?post=raw&bg=off&mat=white&sShadow=1&ps=1&amb=0&hemi=0&ibl=0`

### 1.9 只看飞船 SSAO（环境光自遮蔽）
- `/?post=raw&bg=off&mat=white&ao=ssao&sun=0&amb=0&hemi=0&ibl=1`

### 1.10 日常回归用例（SSAO + 自阴影 + IBL）
- `/?post=raw&bg=dim&mat=default&ibl=10&iblEnv=space&amb=0&hemi=0&ps=1&ao=ssao&sShadow=1&sShadowBias=0.0012&sShadowNBias=0.01&sShadowSBias=0.02&sShadowSoft=1.2&sShadowSamples=16&aa=ssaa`
- `http://localhost:8712/?post=raw&bg=dim&mat=default&ibl=10&iblEnv=space&amb=0&hemi=0&ps=1&ao=ssao&sShadow=1&sShadowBias=0.0012&sShadowNBias=0.01&sShadowSBias=0.02&sShadowSoft=1.2&sShadowSamples=16&aa=ssaa`

### 1.11 全效果（偏物理）
- `/?post=raw&bg=dim&mat=default&ibl=10&iblEnv=space&amb=0&hemi=0&ps=1&ao=ssao&sShadow=1&sShadowBias=0.0012&sShadowNBias=0.01&sShadowSBias=0.02&sShadowSoft=1.2&sShadowSamples=16&aa=ssaa&bloom=1&atmo=1&atmoBloom=1&bloomTh=1.0&bloomRad=0.4&exp=1.2`
- `http://localhost:8712/?post=raw&bg=dim&mat=default&ibl=10&iblEnv=space&amb=0&hemi=0&ps=1&ao=ssao&sShadow=1&sShadowBias=0.0012&sShadowNBias=0.01&sShadowSBias=0.02&sShadowSoft=1.2&sShadowSamples=16&aa=ssaa&bloom=1&atmo=1&atmoBloom=1&bloomTh=1.0&bloomRad=0.4&exp=1.2`

---

## 2. 抗锯齿（AA）

参数：`aa`
- **默认值**：`none`
- **可选值**：
  - `none` / `off` / `0`
  - `smaa`
  - `ssaa`

含义：
- `smaa`：质量/性能均衡，适合默认使用。
- `ssaa`：质量更高、性能更重。

示例：
- `/?aa=smaa`
- `/?aa=ssaa&aaLevel=1`

### 2.1 SSAA 采样等级
参数：`aaLevel`
- **默认值**：当 `aa=ssaa` 时默认 `1`
- **取值范围**：`0` 到 `5`（会 clamp）

示例：
- `/?aa=ssaa&aaLevel=2`

---

## 3. 后处理模式

参数：`post`
- **默认值**：`default`
- **可选值**：
  - `default` / `on` / `1`
  - `raw` / `off` / `0`

含义：
- `post=default`：启用 bloom 合成路径（并包含部分太阳/行星光晕等视觉元素）。
- `post=raw`：**默认**关闭 bloom 合成与光晕类元素，用于做“物理摄影感基线标定”；可通过 `bloom=1`、`atmo=1` 等显式开关覆盖。

示例：
- `/?post=raw`

---

## 4. Debug 视图

参数：`debug`
- **默认值**：`none`
- **可选值**：
  - `none` / `off` / `0`
  - `exposure`
  - `luma`

含义：
- `debug=exposure`：false-color 分段显示亮度阈值（用于定位过曝区域）。
- `debug=luma`：灰度亮度视图。

示例：
- `/?debug=exposure`
- `/?debug=luma`

---

## 5. 环境（IBL / scene.environment）

### 5.1 环境来源模式
参数：`env`
- **默认值**：`canvas`
- **可选值**：
  - `canvas`
  - `room`
  - `hdr`

含义：
- `canvas`：使用程序化 equirect 环境纹理。
- `room`：使用 `RoomEnvironment` 生成的环境。
- `hdr`：用 HDRI（.hdr）作为环境。

示例：
- `/?env=canvas`
- `/?env=room`
- `/?env=hdr`

### 5.2 HDRI URL
参数：`envUrl`
- **默认值**：内置默认 HDRI（venice_sunset_1k.hdr）
- **说明**：仅在 `env=hdr` 时生效。

示例：
- `/?env=hdr&envUrl=<HDR_URL>`

### 5.3 IBL 环境“色调风格”
参数：`iblEnv`
- **默认值**：`default`
- **可选值**：
  - `default`（蓝紫风格的程序化 env，偏风格化）
  - `neutral` / `gray` / `grey`（近黑/中性深空）
  - `space` / `deepspace` / `deep_space`（近黑 + 低频银河 + 太阳反射瓣）

说明：
- 该参数主要用于排查 IBL 偏色、以及提供更接近深空的反射结构。
- 它只影响 `scene.environment`（IBL），不影响背景 stars/nebula。

示例：
- `/?iblEnv=neutral`
- `/?iblEnv=space`

### 5.4 IBL 全局强度
参数：`ibl`
- **默认值**：`1.0`
- **取值**：`>= 0`（负数会被截为 0）

含义：
- 统一缩放场景内 PBR 材质的 `envMapIntensity`。
- 注意：`ibl` 只控制 IBL（`scene.environment` 的间接光/反射）；如果还想去掉其它填充光，需要同时把 `amb=0&hemi=0`。

示例：
- `/?ibl=0`（禁用 IBL 影响）
- `/?ibl=0.5`
- `/?ibl=2.0`

---

## 6. 光照基线（物理摄影感）

### 6.1 曝光
参数：`exp`
- **默认值**：`0.9`
- **取值范围**：`0` 到 `3`（会 clamp）

示例：
- `/?exp=0.8`

### 6.2 太阳主光强度（PointLight）
参数：`sun`
- **默认值**：`3.8`
- **取值**：`>= 0`

示例：
- `/?sun=4.2`

### 6.3 AmbientLight 强度
参数：`amb`
- **默认值**：`0.0`
- **取值**：`>= 0`

示例：
- `/?amb=0.01`

### 6.4 HemisphereLight 强度
参数：`hemi`
- **默认值**：`0.0`
- **取值**：`>= 0`

示例：
- `/?hemi=0.01`

---

## 7. 背景与夜灯

---

## 7.1 背景模式
参数：`bg`
- **默认值**：`default`
- **可选值**：
  - `default` / `on` / `1`
  - `off` / `none` / `0`
  - `dim`

含义：
- `bg=off`：不创建 stars/nebula。
- `bg=dim`：背景明显变暗（用于不干扰曝光/夜面）。

示例：
- `/?bg=off`
- `/?bg=dim`

### 7.2 地球夜灯强度
参数：`city`
- **默认值**：`1.0`
- **取值范围**：`0` 到 `2`（会 clamp）

示例：
- `/?city=0.3`

## 7.3 Warp（时间速度）

参数：`speed` / `warp`
- **默认值**：不指定（使用后端当前 `time_speed`；UI 会在 WS 连接后同步显示实际值）
- **取值范围**：`0` 到 `5`（会 clamp）

含义：
- 用于强制指定刷新/重载后的时间速度（Warp），并让 UI（底部 Warp 滑条）显示与后端一致。

示例：
- `/?speed=1.2`
- `/?warp=0.8`

---

## 8. 行星遮挡太阳直射（飞船材质解析遮挡）

参数：`planetShadow` / `ps`
- **默认值**：关闭
- **开启**：`ps=1` 或 `planetShadow=1`
- **关闭**：`ps=0` / `off` / `false`

含义：
- 对飞船材质注入解析遮挡：对每个片元计算从该点到太阳（原点）的射线是否被地球/火星球体截断。
- 当 `ps=1` 时，遮挡只作用于“太阳主光（PointLight 在原点）”的直射贡献；不会影响 IBL/ambient/hemi。
- 仅用于“星球遮挡太阳直射在飞船上的硬边阴影”验证；半影（软边）后续再做。

推荐标定组合：
- `/?post=raw&bg=off&ps=1&amb=0&hemi=0&ibl=0`

---

## 8.1 飞船自阴影（太阳直射 shadow map，仅飞船）

参数：`sShadow`
- **默认值**：关闭
- **开启**：`sShadow=1`
- **关闭**：`sShadow=0` / `off` / `false`

含义：
- 为飞船启用“太阳直射自阴影”（ship-only shadow map depth prepass + shader compare），只影响飞船的太阳直射贡献（directDiffuse/directSpecular），不影响 IBL/ambient/hemi。
- 与 `ps=1`（行星遮挡太阳直射）相容：当飞船片元处于行星本影时，直射为 0，因此自阴影不会在本影内产生可见变化。

调参（已实现）：
- `sShadowSoft=<float>`：自阴影软硬（PCF 半径，单位为 shadow map texels；默认 `0`=硬边；范围 `0..6`）
- `sShadowSamples=<int>`：PCF 采样数（默认 `16`；范围 `1..25`；越大越自然但更耗）
- `sShadowFit=1|0`：tight fit（默认 `1`；收紧 shadow frustum 到飞船 light-space AABB，减少分辨率浪费）
- `sShadowSnap=1|0`：texel snapping（默认 `1`；将 frustum center 对齐到 texel 网格，降低边缘抖动）
- `sShadowMarginXY=<float>`：tight fit 的 XY 边距（默认：按飞船尺寸自动；单位为 Three.js scene units）
- `sShadowMarginZ=<float>`：tight fit 的 Z 边距（默认：按飞船尺寸自动；单位为 Three.js scene units）
- `sShadowBias=<float>`：常量 bias（默认 `0.0012`；单位为 shadow depth 归一化 0..1）
- `sShadowNBias=<float>`：normal bias（默认 `0`；掠射角增加 bias，缓解 acne）
- `sShadowSBias=<float>`：slope bias（默认 `0`；基于 `fwidth(depth)` 的 bias，缓解高频抖动）

推荐标定组合：
- `/?post=raw&bg=off&mat=white&sShadow=1&ps=1&amb=0&hemi=0&ibl=0`

---

## 9. Contact Shadows / SSAO（Phase 3A：Contact Shadows 已实现）

参数：`ao`
- **默认值**：`off`
- **可选值**：
  - `off` / `0` / `none`
  - `contact`（优先实现）：方向性近场接触阴影（深度 + 太阳方向短距离 raymarch；仅影响太阳直射）
  - `ssao`：飞船屏幕空间环境光遮蔽（ship-only；仅衰减间接光：IBL/ambient/hemi）

说明：
- `ao=contact` 与 `ps=1`（行星遮挡太阳直射）互补：
  - `ps=1` 负责“星球挡太阳”的硬遮挡阴影（只影响太阳直射贡献）。
  - `ao=contact` 负责“飞船近场自遮蔽/接触尺度层次”的补偿（只作用于太阳直射，不影响 IBL/ambient/hemi）。
- 这两个都不应把整张画面压灰；默认强度必须保守，确保不干扰 Phase 2 的照明标定。

推荐验证组合：
- `/?post=raw&bg=off&ao=contact&ps=1&amb=0&hemi=0&ibl=0`

---

## 10. Post FX（Phase 4）

> Phase 4 负责在 HDR 基线稳定后，逐项恢复 Bloom / Atmosphere(Fresnel) / Glow / Lens Flare 等效果。
> Lens Flare 计划迁移为 OutputPass 之后的 post pass（display-referred），避免与 HDR/bloom 强耦合。

### 10.1 Bloom（已实现）
- `bloom=1|0`：独立控制 bloom；默认 `auto`（`post=raw` 默认关，其它默认开），显式指定会覆盖 `post` 的默认值（允许 `post=raw&bloom=1` 做 bloom-only 标定）。
- `bloomStr=<float>`：强度（默认 `0.95`；范围 `0..3`）
- `bloomRad=<float>`：半径（默认 `0.42`；范围 `0..1`）
- `bloomTh=<float>`：阈值（默认 `0.82`；范围 `0..5`）
- `bloomDebug=0|1`：bloom buffer 调试输出（全屏替换，强制 `NoToneMapping`；用于观察 bloom 形态/能量）

### 10.2 Sun Glow（已实现）
- `sunGlow=1|0`：太阳光晕 sprites（非 bloom）开关；默认 `auto`（`post=raw` 默认关，其它默认开），显式指定会覆盖 `post` 的默认值（用于隔离“太阳光晕 vs bloom”贡献）。

### 10.3 Planet Atmosphere / Glow（Phase 4B，已实现）
行星大气 Fresnel 与外圈 glow 走 HDR 口径（scene-referred），可独立控制是否参与 bloom。

- `atmo=auto|1|0`：行星大气 Fresnel 开关（`auto` 默认随 `post`；`post=raw` 时默认关）
- `atmoStr=<float>`：大气强度（默认 `1.0`；范围 `0..6`）
- `atmoBloom=auto|1|0`：大气是否进入 bloom layer（`auto` 默认随 `post`）

- `glow=auto|1|0`：行星外圈 glow sprites（默认 `auto`；当前默认关闭以避免与 bloom 双叠加）
- `glowStr=<float>`：glow 强度（默认 `0.6`；范围 `0..6`）
- `glowBloom=auto|1|0`：glow 是否进入 bloom layer（默认关闭）

推荐验证：
- 仅看 HDR 大气本体：`/?post=raw&bloom=0&atmo=1`
- 让 halo 主要由 bloom 生成：`/?post=raw&bloom=1&atmo=1&atmoBloom=1&bloomTh=1.0&bloomRad=0.4`

### 10.4 其它开关（规划中）
- `flare=1|0`：独立控制 lens flare（post flare）

Contact Shadows 调参（已实现，Phase 3A）：
- `csDist=<float>`：raymarch 最大距离（默认 `0.18`；范围 `0.0..0.5`；单位为 Three.js scene units，越大遮蔽越“宽/厚”但更容易脏/穿帮）
- `csThick=<float>`：厚度/bias（默认 `0.003`；范围 `0.0..0.05`；用于抑制自交/深度精度伪影，越大越“干净”但更容易漏遮蔽）
- `csStr=<float>`：强度（默认 `1.1`；范围 `0.0..2.0`；仅影响 `ao=contact` 的实际着色，不影响 `csDebug=2` 输出的 raw occlusion）
- `csSteps=<int>`：步数（默认 `22`；范围 `1..24`；越大越稳定/细腻但更耗）

Contact Shadows 调试（已实现，全屏替换输出，不经过 tone mapping）：
- `csDebug=0`：关闭
- `csDebug=1`：查看深度场结构（对比增强；仅显示飞船 depth）
- `csDebug=2`：查看遮蔽场（occlusion 0..1；仅显示飞船像素）
- `csDebug` 与 `ao` 独立：`csDebug!=0` 时仅切换 debug 输出（全屏替换），不会强制开启 `ao=contact`；反之亦然。

飞船白模（已实现，用于隔离光照分量；仅影响飞船）：
- `mat=default`：原材质（默认）
- `mat=white`：白模（纯白漫反射基准）

飞船 SSAO（已实现，Phase 3B；ship-only；仅衰减间接光，不影响太阳直射）：
- `ssaoScale=<float>`：内部 AO 计算分辨率比例（默认 `0.5`；范围 `0.25..1.0`；越高越细腻但更耗）
- `ssaoRad=<float>`：采样半径（默认 `0.06`；范围 `0.005..0.25`；单位为 Three.js scene units）
- `ssaoBias=<float>`：bias（默认 `0.0015`；范围 `0..0.02`；用于抑制自交/深度精度伪影）
- `ssaoStr=<float>`：强度（默认 `1.0`；范围 `0..3.0`；越大越“黑”）
- `ssaoPow=<float>`：曲线（默认 `1.2`；范围 `0.2..4.0`；>1 更强调暗部）
- `ssaoSteps=<int>`：采样数（默认 `24`；范围 `1..32`；越大越稳定但更耗）
- `ssaoBlur=0|1`：是否启用 depth-aware blur（默认 `1`；建议开）

SSAO 调试（已实现，全屏替换输出，不经过 tone mapping）：
- `ssaoDebug=0`：关闭
- `ssaoDebug=1`：查看 AO 因子（0..1；仅显示飞船像素）

---

## 11. 参数一览表（速查）

| 分类 | 参数 | 默认值 | 说明 |
|---|---|---:|---|
| AA | `aa` | `none` | `none` / `smaa` / `ssaa` |
| AA | `aaLevel` | `1`(ssaa) | SSAA sampleLevel，0..5 |
| Post | `post` | `default` | `default` / `raw` |
| Debug | `debug` | `none` | `exposure` / `luma` |
| Env | `env` | `canvas` | `canvas` / `room` / `hdr` |
| Env | `envUrl` | 内置 | 仅 `env=hdr` 生效 |
| IBL | `iblEnv` | `default` | `default`/`neutral`/`space` |
| IBL | `ibl` | `1.0` | 全局 IBL 强度缩放 |
| Lighting | `exp` | `0.9` | 曝光 0..3 |
| Lighting | `sun` | `3.8` | 太阳点光强度 |
| Lighting | `amb` | `0.0` | Ambient 强度 |
| Lighting | `hemi` | `0.0` | Hemisphere 强度 |
| Background | `bg` | `default` | `default`/`off`/`dim` |
| Background | `city` | `1.0` | 地球夜灯 0..2 |
| Warp | `speed` / `warp` | (无) | 刷新后强制 Warp（0..5） |
| Shadow | `ps` | `off` | 行星遮挡太阳直射（飞船解析） |
| Shadow | `sShadow` | `off` | 飞船自阴影（ship-only shadow map；仅影响太阳直射） |
| Shadow | `sShadowSoft` | `0` | 自阴影软硬（PCF 半径，单位 texels；0=硬边） |
| Shadow | `sShadowSamples` | `16` | 自阴影 PCF 采样数（1..25；越大越自然但更耗） |
| Shadow | `sShadowFit` | `1` | 自阴影 tight fit（1=收紧 frustum） |
| Shadow | `sShadowSnap` | `1` | 自阴影 texel snapping（1=对齐网格减少抖动） |
| Shadow | `sShadowMarginXY` | auto | 自阴影 tight fit XY 边距（scene units） |
| Shadow | `sShadowMarginZ` | auto | 自阴影 tight fit Z 边距（scene units） |
| Shadow | `sShadowBias` | `0.0012` | 自阴影常量 bias（depth 0..1） |
| Shadow | `sShadowNBias` | `0` | 自阴影 normal bias（掠射角增强） |
| Shadow | `sShadowSBias` | `0` | 自阴影 slope bias（fwidth(depth)） |
| AO | `ao` | `off` | `off` / `contact` / `ssao`（Phase 3） |
| AO | `csDist` | `0.18` | Contact raymarch 最大距离（0..0.5，Three.js scene units） |
| AO | `csThick` | `0.003` | Contact 厚度/bias（0..0.05） |
| AO | `csStr` | `1.1` | Contact 强度（0..2；仅影响实际着色） |
| AO | `csSteps` | `22` | Contact 步数（1..24） |
| Debug | `csDebug` | `0` | `0` / `1` / `2`（Contact Shadows debug） |
| AO | `ssaoScale` | `0.5` | SSAO 内部分辨率比例（0.25..1.0） |
| AO | `ssaoRad` | `0.06` | SSAO 半径（Three.js scene units） |
| AO | `ssaoBias` | `0.0015` | SSAO bias（0..0.02） |
| AO | `ssaoStr` | `1.0` | SSAO 强度（0..3） |
| AO | `ssaoPow` | `1.2` | SSAO 曲线（0.2..4） |
| AO | `ssaoSteps` | `24` | SSAO 采样数（1..32） |
| AO | `ssaoBlur` | `1` | SSAO depth-aware blur（0/1） |
| Debug | `ssaoDebug` | `0` | `0` / `1`（SSAO debug） |
| Material | `mat` | `default` | `default` / `white`（仅飞船） |
| PostFX | `bloom` | auto | `1` / `0`（独立 bloom 开关；默认随 `post`） |
| PostFX | `bloomStr` | `0.95` | bloom 强度（0..3） |
| PostFX | `bloomRad` | `0.42` | bloom 半径（0..1） |
| PostFX | `bloomTh` | `0.82` | bloom 阈值（0..5） |
| PostFX | `bloomDebug` | `0` | `0` / `1`（bloom buffer debug） |
| PostFX | `sunGlow` | auto | `1` / `0`（太阳光晕 sprites；默认随 `post`） |
| PostFX | `atmo` | auto | `auto` / `1` / `0`（行星大气 Fresnel；默认随 `post`） |
| PostFX | `atmoStr` | `1.0` | 大气强度（0..6） |
| PostFX | `atmoBloom` | auto | `auto` / `1` / `0`（大气是否进入 bloom layer） |
| PostFX | `glow` | auto | `auto` / `1` / `0`（行星外圈 glow；默认关闭） |
| PostFX | `glowStr` | `0.6` | glow 强度（0..6） |
| PostFX | `glowBloom` | auto | `auto` / `1` / `0`（glow 是否进入 bloom layer） |
| PostFX | `flare` | (规划) | `1` / `0`（Phase 4，post lens flare） |
