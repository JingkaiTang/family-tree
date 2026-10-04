# PC 家族树父子连线可读性方案

日期：2026-10-04。范围：现有家族网格的父子关系识别、缩放和交互。本文依据当前源码及官方图可视化示例提出建议，尚未在用户具体家谱上完成视觉验收。此次不修改生产功能。

后续实施说明：用户已接受优化，并把高亮范围扩展为选中人物的全部祖先与全部后代。下文保留最初调研和单代概念示意；当前实施行为见[架构说明](../architecture.md#家族网格)，以双向独立追踪避免包含旁系及姻亲。直接增大固定路由间距的试验会使高密度样例出现不可布线路线，因此保留安全间距，并先实现精确高亮、分叉标识及有限缩放补偿。

建议先补齐“悬停预览、选中锁定的关系追踪”，同时改善静态走线与交叉标识，再对拥挤区域做局部路由优化。现有家庭汇合点、子女横线和交叉拱桥可以保留，不需要更换整个布局引擎。

## 当前实现与问题依据

以下为源码事实；“容易混淆”的程度仍需通过实际页面验证。

| 已核实的实现 | 对可读性的影响判断 |
| --- | --- |
| 已有夫妻连线、家庭汇合点，以及同一父母组的主干和子女横线。[家庭组件](../../src/components/tree/FamilyUnit.vue#L183)、[亲子路由](../../src/core/family-layout/routeFamilyLanes.ts#L377) | 基础关系结构已经具备，不能把增加汇合点当作主要新功能。 |
| 同根家庭颜色通常由根色的 RGB 三通道统一偏移 −18 至 18 得到。[颜色生成](../../src/core/family-layout/decorateRootedUnits.ts#L59) | 多个相邻父代可能只有很小的明暗差，颜色难以独立承担家庭识别。 |
| 连线均为 2 个画布单位宽；关系层没有接收人物选中或悬停关系状态，目前淡化来自拖拽。[关系层](../../src/components/tree/RelationLayer.vue#L58)、[调用方](../../src/components/tree/FamilyCanvas.vue#L559) | 全部主线视觉权重接近，选中人物不能帮助追踪父子关系。 |
| 路由子网格为 8，画布最低缩放为 0.2。[布局参数](../../src/core/family-layout/types.ts#L80)、[缩放](../../src/components/tree/PanZoomWrapper.vue#L162) | 例如 50% 缩放时，8 单位通道间隔约为 4 屏幕像素、2 单位线宽约为 1 像素；这只是几何推算，不是截图测量。 |
| 已有交叉拱桥，默认半径上限为 4，二次曲线最大隆起约为 2 个画布单位。[桥几何](../../src/core/family-layout/routeFamilyLanes.ts#L663) | 缩小后仍可能难以看清“经过但不连接”，应改善已有标识。 |
| 路由在找到第一条无冲突候选后接受；扩大代际间距主要由不可路由诊断触发。[候选选择](../../src/core/family-layout/routeFamilyLanes.ts#L132)、[扩容条件](../../src/core/family-layout/layoutFamilyScene.ts#L103) | 不发生几何重叠，不等于路线容易阅读；可进一步减少贴近长段与交叉。 |

## 推荐方案

### 第一阶段 关系追踪与静态识别

1. 悬停家庭汇合点或家庭块时，突出这一组父母到直接子女的完整线路，子女卡片同步强调；选中后锁定，Esc 或空白处退出。键盘聚焦应获得同等反馈。先以节点和家庭块触发，避免线条点击区域干扰画布拖动。
2. 聚焦线置顶，并在常用缩放下保持清晰线宽；其他连线降到约 15% 至 25% 的不透明度作为初始试验值。卡片保留可读性。提示“某某与某某的 3 位子女”，辅助确认关系。
3. 总览态也要能分辨家庭：真实分叉点用小实心点；无关系的交叉使用清晰的桥或断口。重点检查已有桥的尺寸和底色，不给无关系交叉加连接点。
4. 根家族色继续表达来源；局部关系用强调描边、粗细和明暗共同区分。不建议给每条线随机上色，也不应仅用更细微的同色变化解决问题。
5. 悬停只改变呈现，不重排人物、不移动视口。点击与现有选中行为协调；不能覆盖拖拽、双击打开成员及称谓视角的语义。

这些具体交互和数值是本项目的设计建议，不是统一行业标准。低倍率下是否使用非缩放描边或按实际 scale 补偿，需要在现有 CSS transform 画布中实测；单纯加粗全部线会让密集区域更拥挤。

### 第二阶段 拥挤区域走线优化

以实际亲子关系组 `parentageGroup` 为走线归属。同一关系组共享主干；不同关系组即使包含同一位家长，也不能合成一条会误导亲子归属的主干。多伴侣、单亲、继养等情况必须保持现有数据语义。

候选路线除了无碰撞，还应比较交叉次数、与其他家庭长段贴近的长度、折弯数和总长度。拥挤代际局部增加走线空间；通道间距可从 12 至 16 个画布单位做对照试验，并检查是否增加无解路由、回退和画布尺寸。不能只改一个间距常量就承诺解决问题。

保留已有同胞排序和用户拖动偏好，不为了减少交叉任意交换人物。缩放过程中也不应持续改变布局，使用户失去刚找到的路径。

### 大家谱复用已有聚焦纵流

PC 已有“聚焦纵流 / 家族网格”切换，见[架构说明](../architecture.md#聚焦纵流)及[页面入口](../../src/pages/TreeView.vue#L359)。可以增强选中人物到聚焦纵流的快捷入口，以局部查看辅助阅读大树。总览负责寻找位置，局部查看负责读清某个家庭，不必另建第三套布局。

## 一手案例及可借鉴之处

| 案例 | 已核实事实 | 本项目可以借鉴的原则 |
| --- | --- | --- |
| [GoJS Genogram v3.1.9](https://github.com/NorthwoodsSoftware/GoJS/blob/v3.1.9/samples/genogram.html#L132-L141) | 父母间 Mate 连线上的 MateLabel 是子代线源；[源码注释](https://github.com/NorthwoodsSoftware/GoJS/blob/v3.1.9/samples/genogram.html#L750-L758)明确子代线从该节点出发。 | 保留现有“父母汇合后再分到子女”的结构，确保每个实际父母组合的出口明确。引用固定版本，不声称是当前最新示例。 |
| [yFiles Edge Grouping](https://github.com/yWorks/yfiles-for-html-demos/blob/3bbbe5549e189d29fae5c3732d6f0ca8e14758ff/demos/layout/edgegrouping/README.md#L20) | 区分共享部分路径的 edge grouping 和仅共享首段的 port grouping；[示例](https://github.com/yWorks/yfiles-for-html-demos/blob/3bbbe5549e189d29fae5c3732d6f0ca8e14758ff/demos/layout-features/hierarchical-edge-grouping/HierarchicalEdgeGroupingDemo.ts#L41-L50)显式指定分组 ID。 | 路径合并以真实关系归属为依据。同组可合流，不同组保持可辨边界；具体间距是本项目设计。 |
| [yFiles Bridges](https://github.com/yWorks/yfiles-for-html-demos/blob/3bbbe5549e189d29fae5c3732d6f0ca8e14758ff/demos/view/bridges/README.md#L20-L22) | 对边之间的交叉插入桥；[实现](https://github.com/yWorks/yfiles-for-html-demos/blob/3bbbe5549e189d29fae5c3732d6f0ca8e14758ff/demos/view/bridges/BridgesDemo.ts#L120-L128)包含 ARC、GAP 等形式。 | 加强已有交叉提示。桥只能解释点交叉，不能解决长段并行贴近或重合。 |
| [family-chart 路径高亮](https://github.com/donatso/family-chart/blob/c7d22492dfc3090109cf28c6d4c82b1ee4ffd770/src/core/cards/card-html.ts#L151-L188) | 悬停时计算到主人物的路径，为沿途人物与边添加类名；[样式](https://github.com/donatso/family-chart/blob/c7d22492dfc3090109cf28c6d4c82b1ee4ffd770/src/styles/family-chart.css#L527-L536)强调卡片轮廓并加粗线。[局部示例](https://github.com/donatso/family-chart/blob/c7d22492dfc3090109cf28c6d4c82b1ee4ffd770/examples/htmls/v2/15-trim-tree.html#L27-L38)限制上下各一代。 | 借鉴“把当前关注关系完整显出来”。本建议采用直接父子组高亮，与示例的“到主人物路径”不是相同语义；点击锁定、其余淡化和 Esc 退出是本项目建议。 |

这些是官方实现范例，并非已通过本项目用户实验的“唯一最佳实践”。本轮核对了源码，未运行外部产品示例；借鉴表达规则，不复制受许可限制的图库代码，也不建议仅为此次改进更换图库。

## 实现边界与验证建议

`primaryParentageGroups` 可作为关系查询依据，在 [familyCanvasModel.ts](../../src/components/tree/familyCanvasModel.ts#L63) 增加人物、父母组与路线索引，由 FamilyCanvas 管理展示状态，RelationLayer 与 FamilyUnit 同步渲染。第一版按完整家庭组高亮，与已有路由粒度相符。

当前 [RouteSegment](../../src/core/family-layout/types.ts#L266) 只有方向和坐标，没有逐子女分支标识。因此，“只亮某个孩子到父母的那一条路径”需要补充语义归属，不能靠坐标猜测，也不应把兄弟姐妹整个横线误称为该孩子的专属路径。

建议在同一份数据、相同缩放和相同视口下，对比三个阅读任务：找到某组父母的全部孩子；判断两个孩子是否同属一组父母；从某个孩子反向找到父母。使用并列多家庭、跨家族婚配、多伴侣、单亲及现有 200 人样例，观察耗时、误认和是否需要反复放大。检查 100%、75%、50% 及更小倍率，并以灰度验证不依赖颜色。

若进入生产实施阶段，验证悬停不触发布局计算、选中与拖动不冲突、兄弟姐妹次序保留、无新增路由诊断，并完成项目要求的布局性能检查。本轮只是方案调研和独立示意，没有执行生产功能回归测试。

独立交互示意见 [父子连线概念演示](parent-child-connections-demo.html)。示意使用虚构人物，不是当前页面截图，不代表布局算法已经实现这些改动。
