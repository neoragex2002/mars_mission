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
- `post=raw`：关闭 bloom 合成与光晕类元素，用于做“物理摄影感基线标定”。

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
- **默认值**：`0.03`
- **取值**：`>= 0`

示例：
- `/?amb=0.01`

### 6.4 HemisphereLight 强度
参数：`hemi`
- **默认值**：`0.03`
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

## 9. 参数一览表（速查）

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
| Lighting | `amb` | `0.03` | Ambient 强度 |
| Lighting | `hemi` | `0.03` | Hemisphere 强度 |
| Background | `bg` | `default` | `default`/`off`/`dim` |
| Background | `city` | `1.0` | 地球夜灯 0..2 |
| Warp | `speed` / `warp` | (无) | 刷新后强制 Warp（0..5） |
| Shadow | `ps` | `off` | 行星遮挡太阳直射（飞船解析） |

