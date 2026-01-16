# Mars Mission 3D — Lambert + Parking Orbit 轨迹方案（当前实现口径）

本文档描述本仓库 **当前实际实现** 的飞船轨迹与任务调度方案（后端 `backend/orbit_engine.py` + 前端 `frontend/main.js`），包括目标、需求、难点、方案与参数调优口径。

> TL;DR
> - 行星附近：采用 **停泊圆轨道（parking orbit）** 让飞船绕行星转动，避免“贴行星中心”。
> - 行星际：采用 **Lambert 两点边值** 求解日心转移段，随后用两体传播得到连续的日心 Kepler 轨迹。
> - 严格约束：转移段全程对地球/火星的“视觉排斥半径”不穿模（采样严格）。
> - 视觉平滑：前端朝向始终沿运动方向，并对停车/转移的参考系差异做可调的平滑混合。

---

## 1. 目标（Goals）

### G1：观感正确
- 停泊阶段飞船应绕行星转动，而不是停在行星中心。
- 转移阶段飞船应沿一条合理的日心轨道（连续位置），并随时间自然变速。

### G2：严格避碰（视觉尺度）
- 对所有时刻（至少在后端严格校验意义下），飞船与地球、火星都不发生“视觉球体重叠”。

### G3：可用且可调
- 参数集中，可通过调参实现：更早发射 / 更大安全距离 / 更平滑的视觉朝向。
- 不引入新依赖（纯 Python + FastAPI/NumPy 现状）。

---

## 2. 需求与约束（Requirements & Constraints）

### R1：数据契约稳定
- 后端依旧输出 `spacecraft_position`（AU 坐标）与 `phase`（snake_case 字符串）。
- 前端仍使用 `(x,y,z)_backend -> (x,z,-y)_three` 映射渲染。

### R2：严格避碰口径（视觉半径）
前端行星半径是“视觉尺度”而非真实半径，因此避碰口径按视觉球体定义：

- 排斥半径：
  - `r_excl_earth = earth_visual_r + safety_margin + spacecraft_collision_r`
  - `r_excl_mars  = mars_visual_r  + safety_margin + spacecraft_collision_r`

- 硬约束（采样严格）：
  - `dist(ship(t), earth(t)) >= r_excl_earth`
  - `dist(ship(t), mars(t))  >= r_excl_mars`

### R3：不做真实任务设计细节
- 不实现 patched conics 的真实捕获双曲线、B-plane、变轨弧等。
- 出入转移段的速度矢量跳变视为“瞬时燃烧/捕获”（视觉上可做缓和，但物理上不强求 C1 连续）。

---

## 3. 当前实现概览（Where the truth lives）

### 3.1 后端
- 轨道引擎：`backend/orbit_engine.py`
- 任务阶段（phase）：
  - `earth_orbit_stay`
  - `transfer_to_mars`
  - `mars_orbit_stay`
  - `transfer_to_earth`

### 3.2 前端
- 主渲染循环 + WS：`frontend/main.js`
- UI 文案/phase 映射：`frontend/ui.js`

### 3.3 Demo（与后端一致）
- `demo_lambert_parking_trajectory.py`
  - 采样 **后端真实轨迹**，输出 `demo_trajectory_lambert.svg`


---

## 4. 核心难点（Why it’s hard）

### D1：视觉半径与真实尺度不一致
- 行星视觉半径（例如 Earth=0.12 AU）远大于真实比例，导致“物理上不撞但视觉穿模”。
- 必须把“视觉排斥半径”作为硬约束纳入调度。

### D2：轨道计算慢 vs 需要严格筛选
- Lambert 求解 + 碰撞采样校验都是 CPU 工作。
- 如果每次 WS 连接或每帧都做重计算，会卡住 UI。

### D3：朝向参考系差异
- 停车段：飞船的“前进方向”应沿行星相对绕行的切线。
- 转移段：飞船的“前进方向”应沿日心惯性系轨迹切线。
- 直接切换会产生观感突变，需要可控的平滑策略。

---

## 5. 轨迹结构（分段轨迹）

对每次 mission：
1) 地球停车段：`earth_orbit_stay`
2) Lambert 转移段：`transfer_to_mars`
3) 火星停车段：`mars_orbit_stay`
4) Lambert 转移段：`transfer_to_earth`

关键时间点由 schedule 给出：
- `t_start`
- `t_launch_earth`
- `t_arrival_mars`
- `t_depart_mars`
- `t_arrival_earth`

---

## 6. 停车段（Parking Orbit）模型

### 6.1 外侧点（Outer parking point）
- 行星在时刻 t 的位置 `P(t)`
- `r_hat_xy(t) = normalize(P_xy(t))`
- 外侧点：
  - `P_out(t) = P(t) + parking_r * (r_hat_x, r_hat_y, 0)`

该点用于 Lambert 转移的端点（避免从行星中心出发/到达）。

### 6.2 停车圆轨道
- 取日心投影的顺行基：`r_hat` 与 `t_hat`（与行星投影速度同向）。
- 角速度：`omega = 2π / period_days`
- 相位：`phi = omega * (t - t_anchor)`
- 偏移：`offset_xy = cos(phi)*parking_r*r_hat + sin(phi)*parking_r*t_hat`
- 飞船位置：`ship(t) = planet(t) + offset_xy`，z 采用行星 z。

### 6.3 端点对齐
- 使用 `_fit_parking_period(duration, nominal)` 让停车段在关键时刻回到外侧点（位置连续）。

---

## 7. 转移段（Lambert + 两体传播）

### 7.1 Lambert 两点边值
给定：
- 出发点 `r1 = P_out(source, t_depart)`
- 到达点 `r2 = P_out(target, t_arrive)`
- 飞行时间 `dt = t_arrive - t_depart`

求解：
- `v1`：出发速度
- `v2`：到达速度

### 7.2 两体传播
得到 `v1` 后，用太阳引力两体模型传播：
- `r(t) = propagate(r1, v1, t - t_depart)`

### 7.3 物理解释（为何速度不连续）
- 停车段与转移段的速度矢量不必连续。
- 可解释为：在 `t_depart` 与 `t_arrive` 发生瞬时燃烧/捕获。

---

## 8. 任务调度（Schedule search）

目标：尽量早发射且严格避碰，并控制“代价”（Δv proxy）。

### 8.1 搜索策略（当前实现）
- 先用投影相位条件找到窗口中心（粗筛）。
- 在窗口附近枚举：
  - departure 时间
  - transfer dt（在 `dt_guess ± dt_window` 范围内）
- 对每个候选：
  1) 解 Lambert
  2) 计算 Δv proxy（相对行星速度）并施加预算
  3) 通过 `_transfer_leg_clearance_ok` 采样检查对两行星不穿模
- 选最小代价的可行候选。

### 8.2 “尽量早发射”与“预算/避碰”的取舍
- `lambert_max_total_dv` 越小：越物理、越稳定，但可能推迟发射窗口。
- `safety_margin` / `spacecraft_collision_r` 越大：越安全，但也更可能推迟窗口。

---

## 9. 前端朝向（Orientation）与过渡带

### 9.1 朝向目标
- 飞船模型朝向始终沿其运动方向（切线方向）。

### 9.2 停车 vs 转移
- 转移段：使用惯性系方向 `shipDelta`。
- 停车段：使用相对方向 `shipDelta - planetDelta`，避免行星平移支配朝向。

### 9.3 过渡带（可中断/可连跳）
- 使用连续权重 `w ∈ [0,1]`：
  - `w → 1` 表示更偏停车（相对方向）
  - `w → 0` 表示更偏转移（惯性方向）
- 每帧按时间常数 `orientationBlendTauSec` 做指数趋近：
  - `w = w + (targetW - w) * (1 - exp(-dtSec/tau))`

该机制能稳定支持短停车/连跳相位，不会出现“过渡没结束又重启”的抽搐。

---

## 10. 参数表（当前默认值）

后端默认值位于 `backend/orbit_engine.py`：
- `earth_visual_r = 0.12`
- `mars_visual_r = 0.08`
- `safety_margin = 0.04`
- `spacecraft_collision_r = 0.006`（与飞船视觉缩放对应）
- `earth_parking_r = 0.20`
- `mars_parking_r = 0.18`
- `earth_parking_period_days = 70`
- `mars_parking_period_days = 55`

前端可调：
- `frontend/main.js`：`orientationBlendTauSec = 0.25`（越大越丝滑）

---

## 11. 验证方式（How to validate）

### 11.1 单元/自检
- `python3 test.py`
  - 包含 Lambert 端点命中、转移段不穿模回归。

### 11.2 视觉/轨迹 demo（与后端一致）
- `python3 demo_lambert_parking_trajectory.py`
  - 输出 `demo_trajectory_lambert.svg`
  - 打印 outbound/inbound/full 的最小距离与 OK/FAIL

---

## 12. 已知局限（Known limitations）

- 避碰严格性目前是“采样严格”，不是数学证明严格。
- 停车轨道是动画模型，并非严格的行星二体轨道。
- Lambert + 两体传播是日心两体近似，不包含多体摄动。

---

## 13. 调参指南（常见诉求）

### 13.1 想让飞船离行星更远
- 优先增大：`earth_parking_r` / `mars_parking_r`。
- 注意：停车半径变大会影响 Lambert 端点位置，可能改变窗口与 Δv。

### 13.2 想更严格不穿模
- 增大：`safety_margin` 或 `spacecraft_collision_r`。
- 注意：会更难找到早发射窗口。

### 13.3 想朝向更丝滑
- 增大：`frontend/main.js` 的 `orientationBlendTauSec`。

