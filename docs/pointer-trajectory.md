# 带时间的光标坐标轨迹

`shared/pointer-trajectory.ts` 只生成坐标和计划时间，不访问页面、不执行输入、不保存光标状态。主进程和前端均可使用，无新增依赖。

## 使用

```ts
import { generatePointerTrajectory, toPointerInputSequence } from './shared/pointer-trajectory'

const points = generatePointerTrajectory({
  from: { x: 20.5, y: 80 },
  to: { x: 640.25, y: 360 },
  durationMs: 650,
  sampleRateHz: 120,
  timing: 'lognormal',
  curvature: 0.12,
  jitterPx: 0.35,
  seed: 'run-42/move-1',
})

// points: [{ x: 20.5, y: 80, atMs: 0 }, ..., { x: 640.25, y: 360, atMs: 650 }]
const steps = toPointerInputSequence(points)
// steps: [{ kind: 'mouse', type: 'mouseMoved', x: 20.5, y: 80, atMs: 0 }, ...]
```

在支持该方法的定制 Electron 中，由调用方执行：

```ts
const result = await webContents.dispatchInputSequence(steps, { signal })
```

项目已固定 `45.0.0-cloudbypass.4`，并在独立的已校验发布运行时中完成真实输入验证。生成器本身仍只处理数据；`electron/modules/pointer-motion.ts` 负责单批派发、同窗口排队、逻辑位置缓存和失败处理，现已接入 Agent 工具。具体路由与实测边界见 [浏览器自动化](browser-agent-automation.md)。

## 坐标与时间约定

- `x/y` 为 CSS 像素，保留小数。所有起点、终点、控制点、边界必须使用同一个坐标系；生成器不进行 DPI、窗口或 iframe 坐标转换。
- `atMs` 是相对整段输入序列开始的累计毫秒偏移，允许小数，不是 Unix 时间戳，也不是相邻点间的等待时间。移动首点为 `0`，末点为总时长，时间严格递增。
- 转换器只输出 `kind/type/x/y/atMs`，不会传递额外字段，也不会填充 `timestamp`、`target` 或按钮状态。与按下、释放步骤放在同一批次时，移动步骤由原生调度器继承本批的按钮状态。
- 转换器不输出 `target`，因此直接派发的坐标应为顶层视口 CSS 像素。它不负责跨框架路由、命中检测或目标跟踪；宿主可在确认整条轨迹均为目标相对坐标后，为所有步骤添加同一 target。
- 生成器每次从 `0` 计时。拼接多段时，调用方须给后段每个 `atMs` 加上时间偏移，并确保总时间及总步数符合内核限制。计划时间不等于实际派发时间保证。

## 微调速度与间隔

```ts
const points = generatePointerTrajectory({
  from: { x: 20, y: 80 },
  to: { x: 640, y: 360 },
  durationMs: 600,
  speedMultiplier: 1.25, // 整体速度提高 25%，最终时长为 600 / 1.25 = 480 ms
  intervalMs: 7.5,      // 每 7.5 ms 生成一个移动点，支持小数
  seed: 'run-42/move-1',
})
// atMs: 0, 7.5, 15, ... , 480
```

`speedMultiplier` 控制整段动作的快慢，默认 `1`；例如 `1.05` 提速 5%，`0.95` 降速 5%。不填写 `durationMs` 时，也可对自动估计的时长应用倍率。最终时长为「基础时长 / 速度倍率」，速度曲线保持原有形状。

`intervalMs` 控制事件的采样间隔，必须与 `sampleRateHz` 二选一。提供它时，采样时间为 `0, intervalMs, 2 × intervalMs, ...`，最后补上精确终点；总时长无法整除间隔时，末段间隔会更短。它改变采样密度，整段时长仍由基础时长和速度倍率决定。

未提供这两个新参数时，原有生成行为不变。倍率调整后的时长仍须符合内核的 `60000 ms` 上限，点数仍不得超过 `10000`；不静默压缩、截断或修改输入参数。

## 运动生成

空间路径采用三阶贝塞尔，可显式指定两个 `controlPoints`。默认控制点沿移动方向生成受限弯曲；连续的低频扰动在两端逐渐收敛，并随短距离自动减小。扰动属于整条路径的一部分，不是在每个采样点独立叠加随机偏移。

先对完整路径建立弧长查找表，再把时间进度映射为已走路程，减少贝塞尔控制点分布对速度的影响。弧长和速度积分采用有限分辨率数值近似。

- `timing: 'lognormal'`（默认）：对数正态速度脉冲叠加，经端点衰减和积分归一化，产生不对称的加减速节奏及小幅后段修正。它是实用的速度模型，不声称是用真实鼠标样本拟合的完整 Sigma-Lognormal 模型。
- `timing: 'minimum-jerk'`：五次平滑时间进度，适合稳定、可预测的移动。用于曲线路径时，不声称整条运动达到严格的全局最小 jerk。

省略 `durationMs` 时，根据起终点距离、`targetWidthPx` 和少量种子控制的变化估计基础时长，范围为 `80–1800 ms`，再除以 `speedMultiplier`。距离增加时变慢，目标更宽时变快；系数为初始调参值，尚未用真实操作数据校准。自定义曲线很长时，建议显式指定基础时长。

## 参数与边界

- `durationMs`：基础时长，移动时大于 `0`，最多 `60000 ms`；省略时自动估计。实际末点时间为 `durationMs / speedMultiplier`，自动估计时同样应用倍率。
- `speedMultiplier`：有限正数，默认 `1`；大于 `1` 加速，小于 `1` 减速。调整后的时长也不得超过 `60000 ms`，正时长不能因浮点下溢变为 `0`。
- `sampleRateHz`：`1–240`，默认 `120`，不能与 `intervalMs` 同时传入。通过均匀时间采样覆盖倍率调整后的整个时长，末点精确对齐，实际间隔可能略短于名义采样间隔。时长小于一个采样间隔时仍保留起终点。
- `intervalMs`：可选，有限正数、最多 `60000 ms`，支持小数。指定后按精确间隔采样移动，末段允许缩短；实际精度仍取决于原生调度器。
- `curvature`：`0–1`，默认 `0.12`；显式控制点覆盖自动曲率。
- `jitterPx`：`0–10`，默认 `0.35`；设为 `0` 可关闭空间扰动。
- `targetWidthPx`：有限正数，默认 `24`；只影响自动估计时长。
- `seed`：有限数字或字符串；相同选项和种子产生相同结果。省略种子则每次生成不同的计划。
- `bounds: { x, y, width, height }`：可选，宽高为有限正数，边界为包含端点的连续区间 `[x, x + width] × [y, y + height]`。起终点和显式控制点越界会报错；自动控制点和扰动受边界约束。
- 起终点相同时，默认只返回 `atMs: 0` 的一个点；显式正时长返回同坐标的首末两点，末点时间同样应用速度倍率。这是坐标序列中的停留，不模拟鼠标按住。

与新版内核一致，每批最多 `10000` 点，坐标范围为 `±1000000`，时间范围为 `0–60000 ms`。超出限制直接报错，不静默截断、不改变请求时长。转换器也独立校验外部点数组，允许相同时间的点并保留数组顺序。

本共享模块只生成移动步骤。宿主集成已支持坐标点击、完整拖动及 Agent 工具调用；真实操作采样、闭环目标跟踪和系统光标控制不属于本模块。

## 验证

`shared/pointer-trajectory.test.ts` 和 `electron/modules/pointer-motion.test.ts` 由现有 `npm test` 自动收集，覆盖生成、速度微调、原生步骤格式、单批操作、排队与取消。`npm run typecheck` 检查共享代码及调用类型，`npm run test:browser:pointer` 验证真实 `.4` 派发。
