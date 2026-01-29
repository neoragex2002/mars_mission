# Issue：飞船太阳能板追日

## 摘要

为 GatewayCore 太阳能板实现追日功能，使面板正面在飞行过程中始终对准太阳方向。本文档记录了已验证的节点层级与朝向约束，确保实现稳定可复现。

## 模型与节点层级

- 模型：`frontend/assets/models/GatewayCore_Nasa.glb`（后端启动时缺失会自动下载；下载源见 `backend/main.py:GATEWAY_CORE_NASA_URL`；前端加载后会应用坐标系矫正矩阵）
- 目标节点：`Maxar_PPE_Array`（NASA 原始模型可能命名为 `Maxar_PPE Array`；代码会做空格/下划线归一）
- 父级链路（子到根）：
  - `Maxar_PPE_Array`
  - `Maxar_PPE`
  - `mover`
  - `GatewayCoreglb`
  - `scene.glb`
- Skins/bones：无，全部为节点层级变换。

## 坐标系（模型本地）

- 飞船模型本地坐标：+Y 向上、+X 向右、+Z 为船头朝向。
- 太阳能板平面在模型本地中近似落在 XY 平面。
- 太阳能板正面法线方向：**-Z**（明确需求）。

## Maxar_PPE_Array 的模型本地 AABB（含父级变换）

以下尺寸为将 `Maxar_PPE_Array` 的几何体经完整父链变换到模型本地后计算得到的 AABB 尺寸：

- X 方向长度：约 43.0158
- Y 方向长度：约 9.9110
- Z 方向厚度：约 0.8257

注意：必须使用完整父链变换；仅使用节点本地变换会导致尺寸和轴向判断错误。

## 追日旋转约束

- 旋转轴：**模型本地 +X 轴**（飞船本地 X 轴）穿过 `Maxar_PPE_Array` 的 pivot。不要假定节点本地 X 与模型 X 一致。
- 旋转原点：`Maxar_PPE_Array` 节点的**本地原点（pivot）**，不是飞船根节点。
- 目标对齐：面板正面法线（-Z）对准太阳方向。

## 实现说明

- 必须在解算旋转角之前，将太阳方向转换到模型本地空间。
- 旋转只作用于 `Maxar_PPE_Array`，并保持其本地 pivot。
- 不需要任何 skin/bone 动画。
- 基准姿态：在 GLB 加载完成后缓存节点初始本地旋转（x/y/z 或四元数），作为零位；追日旋转作为绕 X 轴的增量叠加到基准上。
- 轴基准：模型坐标轴优先来自 `modelCalibrationRoot`（若存在），否则回退到 `modelRoot` 或飞船根节点，以保证校准旋转被正确考虑。

## 集成风险与要求

- 更新顺序：追日更新前需保证 `sunWorldPosition` 已更新，并在方向转换前调用 `mesh.updateWorldMatrix(true, false)`。
- 现有动画冲突：`updateNavigationLights` 对后备面板有正弦摆动，启用追日时必须 gate 或禁用以避免相互打架。
- 轴向对齐：节点本地轴不等同于模型轴。需在节点本地空间中求出模型 X 轴与模型 -Z 法线，并绕该轴旋转以对准太阳方向；保留原始旋转并叠加 delta。
- 旋转空间：增量旋转必须在**父空间**应用（premultiply），因为旋转轴定义在模型空间而非节点本地。
- 初始姿态：以节点初始本地旋转为零位基准，追日旋转作为 delta 叠加。
- 时间步长：使用稳定的 `dt`（秒）；若仿真时间跳变或暂停，需 clamp 大 `dt` 以避免瞬间跳转。
- 时间基准：`dt` 使用仿真时间（非真实时间）。
- 回退安全：找不到 `Maxar_PPE_Array` 或 GLB 加载失败时，不报错，保持当前姿态/回退行为。
- 模型替换：并非所有模型都有 `Maxar_PPE_Array`，追日逻辑需封装为独立方法，并只在一个入口调用，方便后续快速注释掉（不删除）。
- 多面板：若存在多个 panel array，需对每个节点应用同样的追日。
- 机械限位：将面板角度夹在 ±80°（弧度制）。默认关闭；设置 `panelTrackingLimitEnabled = true` 开启；或设置 `panelTrackingMaxDeg <= 0` 也可关闭。

## 边界情况与平滑策略

### 太阳方向近乎垂直

由于面板只能绕本地 X 轴旋转，其法线只能在本地 YZ 平面内扫动。当太阳方向接近本地 X 轴时，YZ 投影过小，目标角不稳定。

- 计算 `lenYZ = sqrt(y * y + z * z)`。
- 若 `lenYZ < epsilon`，保持当前角度（或上一次稳定角度），不允许瞬变/翻折。
- 在不可达方向上取最优可达姿态，避免抖动。

### 平滑连续旋转

面板不应瞬间跳到目标角。可用以下方案之一：

- 方案 A（限速旋转）：
  - `delta = shortestAngle(target - current)`
  - `maxStep = maxSpeedRad * dt`
  - `current += clamp(delta, -maxStep, maxStep)`
- 方案 B（指数平滑）：
  - `alpha = 1 - exp(-k * dt)`
  - `current += alpha * shortestAngle(target - current)`

推荐默认值：
- `maxSpeedDeg = 12`（每秒）
- `epsilon = 1e-3`

### 最小旋转规则

- 目标角由 `atan2` 计算得到绕模型 X 轴的最小有符号角。
- 当限位关闭时，将目标角 unwrap 到最接近当前角的等价角，保证始终走最短路径。

## 状态

- 已实现。
- 追日逻辑已在父空间运行，使用模型 X 轴与模型 -Z 正面，支持可选限位与平滑最小旋转。
