# Mars Mission —— 严格霍曼半椭圆 + 动态发射窗口（顺行）方案报告

日期：2026-01-06

> 目标：在保留行星倾角（3D）的前提下，使飞船地火/火地转移段呈现**严格霍曼“半椭圆外观”**，并且**永远顺行（从“顶视 +Y→-Y”看为逆时针）**；允许任务等待时间/窗口动态变化，前端 UI/时间轴配合后端。

---

## 1. 已确认决策（你的要求）

1) **后端任务周期动态化**：单次任务总时长不再固定，前端 timeline/UI 完全配合后端。
2) **后端保留行星倾角**：行星输出为 3D 坐标，不强制共面。
3) **飞船姿态不强制 yaw-only**：继续沿用前端现有 `mesh.lookAt(...)` + 四元数 `slerp` 的 3D 朝向方式。
4) **转移轨迹严格霍曼外观**：半椭圆、永远顺行；发射窗口/等待时长可动态。
5) **霍曼半椭圆 r1/r2 取瞬时半径**：使用出发时刻/到达时刻的瞬时日心距离（基于 `sqrt(x^2+y^2)` 投影半径），不固定 1AU/1.52AU。
6) **前后端坐标轴对齐**：
   - 后端 `+X` 与前端 `+X` 对齐（向右）
   - 后端 `+Y` 与前端 `-Z` 对齐（向屏幕内）
   - 后端 `+Z` 与前端 `+Y` 对齐（向上）

对应后端→three.js 映射（保持右手，不做镜像）：

```
X_front =  X_back
Y_front =  Z_back
Z_front = -Y_back
```

---

## 2. 现状评估（当前代码与目标的差距）

### 2.1 后端差距（必须改）

- 行星是 3D（倾角保留）——符合决策。
- 但转移段目前不是严格霍曼半椭圆：采用“角度线性插值 + 半径线性插值 + bulge”的经验轨迹（`backend/orbit_engine.py` 的 `_get_transfer_position`）。
- 且转移段**并非永远顺行**：当前做“最短角差”归一（`delta_theta` 被压到 `[-π, π]`），某些任务会出现角度随时间减少（逆行/反向绕行）。
- 任务阶段目前基于固定周期取模（`time_days % single_mission_duration`），无法表达“动态窗口/等待时长”。

### 2.2 前端差距（必须改）

- 当前前端坐标映射是 `(x, z, y)`（例如 `frontend/main.js` 创建轨道/设置 targetPos），这与新约定 `(x, z, -y)` 不一致；缺少 `-` 会导致观察方向/顺逆时针呈现被镜像翻转的风险。
- 顶视（Top view）相机通常放到 `(0, +Y, 0)` 且 `camera.up=(0,1,0)` 会发生“方向与 up 共线”的退化，需要在 Top 模式显式修正 `camera.up` 或加入极小偏移。
- 飞船 lookAt+slerp 方案我们保留，只需要保证 lookTarget 在新坐标映射后计算。

**结论**：当前实现无法与上述约定“基本吻合”，需要后端重构“霍曼+动态窗口+顺行保证”，并同步修正前端坐标映射与 Top 视角稳定性。

---

## 3. 后端改造方案（核心：严格霍曼外观 + 动态窗口 + 顺行）

> 核心思路：
> - 行星继续用现有轨道根数计算 3D 位置。
> - 转移段以 **后端 x-y 投影平面**作为“霍曼外观参考平面”（顺行判定也基于此投影）。
> - 在该平面内用开普勒椭圆（半椭圆）推进，保证 **ν 单调递增**（永远顺行）。
> - z 分量保留倾角效果：转移段 z 在端点之间插值（连续、可接受的小倾角）。
> - 动态发射窗口：通过数值求解满足“半椭圆转过 π 后命中目标行星方位角”的发射时刻。


### 3.1 定义“顺行/逆行”判据（投影平面）

- 对任意点（行星/飞船），定义投影角：
  - `θ(t) = atan2(y(t), x(t))`（只用后端 x-y 投影）
- “顺行/逆行”以 `θ` 的随时间变化为准：
  - 期望：`θ` 在转移段内单调增加（做 unwrap 后，无负步长）

> 这与“从后端 +Z 俯视是逆时针”一致；映射到前端后仍保持右手旋转一致性。


### 3.2 单次任务不再固定：引入 MissionSchedule（动态时间表）

新增数据结构（建议 dataclass）：

- `MissionSchedule`
  - `mission_index`（从 0 开始）
  - `t_start`（到达地球/开始该次任务）
  - `t_launch_earth`
  - `t_arrival_mars`
  - `t_depart_mars`
  - `t_arrival_earth`（该次任务结束）
  - 可选缓存：每段转移的关键参数（`a,e,p,n,theta_depart,theta_peri,...`）避免重复算

OrbitEngine 内维护 `self._schedules: list[MissionSchedule]`。
- 对 `time_days` 查询时，确保 schedules 已生成到覆盖该时间。
- `mission_number` 直接等于当前 schedule 的 `mission_index`。


### 3.3 霍曼半椭圆参数（r1/r2 使用瞬时半径）

对一次转移（source→target）：

- 给定出发时刻 `t0`，出发行星位置 `p0 = source(t0)`
- 给定到达时刻 `t1`，到达行星位置 `p1 = target(t1)`

只在投影平面取瞬时半径：
- `r1 = sqrt(p0.x^2 + p0.y^2)`
- `r2 = sqrt(p1.x^2 + p1.y^2)`

椭圆参数（半椭圆外观）：
- `a = (r1 + r2) / 2`
- `e = (max(r1,r2) - min(r1,r2)) / (max(r1,r2) + min(r1,r2))`
- `p = a(1-e^2)`
- 平面内平均角速度（rad/day）：`n = sqrt(μ / a^3)`

其中 `μ` 使用 AU³/day²。
- 建议固定使用太阳 μ：`μ ≈ 0.0002959122082855911 AU^3/day^2`（稳定、简单）。


### 3.4 半程飞行时间 T_half 的自洽（因为 r2 依赖到达时刻）

由于 `t1 = t0 + T_half`，而 `r2` 需要用 `target(t1)` 的瞬时半径，因此 `T_half` 需要自洽求解。

对给定 `t0`，做固定点迭代：

1) 初始化 `T = T_guess`（可以用上一轮同段 T、或 259 天作为初值）
2) 重复迭代直到收敛：
   - `t1 = t0 + T`
   - `r1 = r_xy(source, t0)`
   - `r2 = r_xy(target, t1)`
   - `a = (r1+r2)/2`
   - `T_new = π * sqrt(a^3 / μ)`
   - 若 `|T_new - T| < ε`（如 1e-6 天）则收敛，否则 `T = T_new`

得到自洽的 `T_half(t0)` 与 `t1`。


### 3.5 动态发射窗口求解（关键：保证“半椭圆转过 π 命中目标”）

地球→火星（outward）：严格半椭圆意味着平面内真近点角 `ν` 从 `0 → π`，等价于**日心方位角增加 π**。

定义误差函数（角度要处理 wrap）：

- 先用 3.4 得到 `T_half(t)` 与 `t_arr = t + T_half(t)`
- `θ0 = atan2(y_earth(t), x_earth(t))`
- `θ1 = atan2(y_mars(t_arr), x_mars(t_arr))`
- 目标条件：`θ1 == θ0 + π (mod 2π)`
- 误差：`err(t) = wrap_to_pi( θ1 - (θ0 + π) )`

求解：在 `t >= earliest` 的范围内找到 `err(t)=0` 的第一个根，即下一次发射窗口。

推荐数值策略（鲁棒、无需导数）：
1) **粗扫**：从 `earliest` 起按步长（如 0.5~2 天）扫描一定窗口（如 1200 天），计算 `err(t)`。
2) 找到一段区间 `[tA, tB]`，满足：
   - `err(tA)` 与 `err(tB)` 异号
   - 且该区间未跨越 `±π` 的 wrap 跳变（可通过同时计算未 wrap 的角差并做 unwrap 来过滤假 bracket）
3) **二分法**细化到指定精度（如 1e-6 天）。

火星→地球（inward）同理，只是 source/target 互换。

> 说明：这个求根会自然决定“地球等待时间 / 火星等待时间”，因此任务周期动态化。


### 3.6 飞船在半椭圆上的位置计算（严格外观 + 永远顺行）

以投影平面 x-y 作为霍曼平面，按开普勒椭圆推进。

#### Earth→Mars（outward）
- 设 `θ_dep = θ_earth(t_launch)`（投影平面方位角）
- 对任意 `t ∈ [t_launch, t_arrival)`：
  - `τ = t - t_launch`
  - `M = n * τ`（rad），范围 `[0, π)`
  - 解开普勒方程：`M = E - e sin E` 得 `E`
  - 真近点角 `ν`（由 E 转换）
  - 平面内惯性方位角：`θ = θ_dep + ν`（单调增，永远顺行）
  - 半径：`r = p / (1 + e cos ν)`
  - 平面内位置：`x = r cos θ`, `y = r sin θ`

#### Mars→Earth（inward）
仍要求顺行（θ 单调增）。做法：让出发点是 apoapsis（ν=π），到达点是 periapsis（ν=2π≡0）。

- 设 `θ_dep = θ_mars(t_depart)`（此时在 apoapsis）
- 则 periapsis 方向 `θ_peri = θ_dep + π`
- 对 `t ∈ [t_depart, t_arrive)`：
  - `τ = t - t_depart`
  - `M = π + n * τ`（rad），范围 `[π, 2π)`
  - 解 `M = E - e sin E` 得 `E`
  - 得 `ν`（应在 `[π, 2π)`）
  - 方位角：`θ = θ_peri + ν`（仍单调增）
  - `r = p / (1 + e cos ν)`
  - `x = r cos θ`, `y = r sin θ`

#### z 分量（保留倾角、允许小起伏）
- 对转移段 z 不做霍曼平面计算，采用端点插值保证连续：
  - `z = z0 + (z1 - z0) * progress`
  - `progress = (t - t0) / (t1 - t0)`

这样：平面内严格半椭圆外观 + 3D 小倾角连续。


### 3.7 后端接口/数据结构调整建议

因为任务周期动态，建议：
- WebSocket `update` 消息中携带当前 mission 的 schedule 信息（关键时间点 + 该段 T_half）。
- `/api/mission/info` 不再返回单个固定 `total_duration`，而返回：
  - 模型类型：`dynamic_hohmann`
  - `mu` 数值
  - 预生成前 N 次任务 schedule（供前端初始化 timeline 规模与刻度）


### 3.8 后端验收（建议加自动化回归）

- **顺行性**：对每次转移段采样，验证 `unwrap(atan2(y,x))` 单调递增。
- **端点命中**：在 `t_arrival_mars`，飞船位置与 `mars(t_arrival_mars)` 在 x/y（以及 z 插值目标）上误差 < 容忍阈值；火地同理。
- **外观半椭圆**：在局部坐标（以 periapsis 方向为 x 轴）下采样点应贴近椭圆方程（允许数值误差）。

---

## 4. 前端改造方案（按轴对齐 + 顶视逆时针 + 保留 lookAt+slerp）

### 4.1 统一后端→three 坐标映射（唯一入口函数）

新增一个工具函数（伪代码）：

- `backendToWorld([x,y,z]) => new THREE.Vector3(x, z, -y)`

然后全局替换所有当前的 `(x, z, y)` 映射点：
- 轨道线：`positions.push(x, z, -y)`
- 地球/火星位置：`targetPos.set(x, z, -y)`
- 飞船位置与 trail 点：一致使用 `backendToWorld`

这样严格满足你的轴对齐约定。


### 4.2 顶视（Top view）稳定性与“逆时针”呈现

你要求：从前端 `+Y` 看向 `-Y`（顶视），轨道与转移都应呈现**逆时针顺行**。

注意：相机在正上方 `(0, H, 0)` 且 `camera.up=(0,1,0)` 会退化。

推荐 Top 模式实现：
- 进入 Top 模式时设置：
  - `camera.position = (0, H, eps)`（eps 很小，例如 0.001）并 `camera.lookAt(0,0,0)`
  - **同时**把 `camera.up` 固定为 `(0, 0, -1)`，保证屏幕“向上”对应世界 `-Z`，这样绕 `+Y` 的顺行会稳定显示为“逆时针”。

> 为什么选 `up=(0,0,-1)`：在右手系里，正的 Y 轴旋转会把 +X 朝向 -Z；当屏幕上“上”是 -Z 时，运动表现为 CCW。


### 4.3 保留飞船姿态（lookAt + slerp）

- 不做 yaw-only。
- 仅需保证：
  - `lookTarget` 的计算与 `targetPos` 同一套映射后的世界坐标。
  - 飞船 mesh 的 `up`（默认 (0,1,0)）保持即可。


### 4.4 行星自转方向（顶视下“看起来也大致逆时针”）

- 当前代码对地球/火星使用 `mesh.rotation.y += ...`。
- 在完成坐标映射 + Top view up 修正后，顶视下自转方向应较稳定。
- 若肉眼观察仍反向：
  - 只需把 `rotation.y` 的增量符号翻转（这是纯视觉约定，不影响轨道物理）。


### 4.5 Timeline/UI（前端配合后端动态 schedule）

由于任务周期动态，前端 timeline 建议二选一：

- **方案 A（绝对时间）**：timeline 表示绝对 `time_days`，当仿真跑出当前 `max` 时，动态扩展 `timeline.max`。
- **方案 B（任务内时间）**：timeline 表示当前 mission 的 `time_in_mission`，`max=mission_duration`；切换 mission 时重置滑条但显示 mission_number。

因为你说“前端将就后端”，建议后端每次 update 都发当前 mission 的 schedule，前端按 schedule 画刻度（launch/arrival/depart/return）。

---

## 5. 推荐实施顺序（可逐步验收）

1) 后端：实现 schedule 生成框架（动态 mission），先只生成 Earth→Mars 发射窗口并验证顺行。
2) 后端：实现 Mars→Earth 窗口与完整 mission schedule。
3) 后端：替换转移段位置计算为严格霍曼半椭圆推进（含 T_half 自洽迭代 + z 插值）。
4) 后端：更新 WebSocket/update payload（携带 schedule），调整 `/api/mission/info` 结构。
5) 前端：全局替换坐标映射为 `(x, z, -y)`；修正 Top view 稳定性（camera.up/eps）。
6) 前端：按 schedule 改 timeline 与刻度展示；验证顶视下轨道与转移均逆时针顺行。
7) 回归测试：加入“转移段角度单调递增 + 端点命中”的自动化校验。

---

## 6. 需要确认的最后一个点（否则实现会走两套）

你允许“用瞬时半径 r1/r2”，这会导致 `T_half` 也随窗口/任务变化（符合动态周期）。
请确认：
- “严格霍曼外观”的判定以 **投影平面 x-y 的半椭圆** 为准（z 仅做连续插值，不要求严格共面椭圆）。

若确认无误，我将按本方案开始逐个落地实现。
