# 家庭单元网格排版引擎设计

**日期：** 2026-07-11  
**状态：** 已完成产品方向确认，等待用户审阅正式规格  
**目标规模：** 默认支持 500 位成员

## 1. 背景

现有排版实现经历了通用 ELK 布局、语义约束布局和严格网格布局三轮演进。当前网格布局已经具备代际行、夫妻槽位和同代拖拽，但仍有以下根本问题：

- 夫妻只是相邻人物卡片，不是完整的可视与交互单元。
- 父子连线没有端口、障碍物和线路归属模型，可能悬空、穿过卡片或互相覆盖。
- 同代多个家庭的父子线路可能共享同一段水平线或垂直线，使两个家庭看起来发生了关系汇合。
- 单个数值 `order` 不能稳定表达一次完整的网格重排。
- 同一血缘树的成员没有正式的紧凑度目标。
- 一旦出现多组交叉婚姻，严格左右血缘分区无法成立。

本设计从头定义一套家庭单元驱动的代际网格引擎。它借鉴分层图布局、家谱婚姻虚拟节点、bus-style edge grouping、增量布局和 sortable grid 的成熟原则，但不使用通用图布局引擎输出最终坐标。

参考：

- [GoJS Genogram](https://gojs.net/latest/samples/genogram)：夫妻节点对作为一个分层布局顶点。
- [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)：分层、交叉最小化、端口和正交路由。
- [yFiles Edge and Port Grouping](https://docs.yworks.com/yfiles-html/dguide/layout-edge_grouping/)：相同关系组共享线路形成 bus。
- [yFiles Incremental Layout](https://docs.yworks.com/yfiles-html/dguide/layout-incremental_layout/)：保留旧布局并局部插入变化元素。
- [dnd-kit Sortable](https://docs.dndkit.com/presets/sortable)：插入式重排、DragOverlay 和邻居漂移动画。

## 2. 已确认的产品决策

1. 使用卡片化代际网格。
2. 当前夫妻组成一个 `FamilyUnit`，作为布局和拖拽的基本单元。
3. 家庭单元采用柔和家庭色底板；人物卡保持独立白色卡片。
4. 夫妻之间使用明确的夫妻轴和中心 `UnionHub`。
5. 主体父子线路使用家庭色贯穿整条线路。
6. 不同家庭的线路可以交叉，但不得共享任何正长度线段。
7. 只有同一 `ParentageGroup` 的父子线路可以合并主干和子女 bus。
8. 拖拽家庭单元时，同代邻居实时漂移；直接子女落点后局部回流；其他分支保持稳定。
9. 同一血缘树尽量靠近，但左右血缘归属是软约束。
10. 单一婚姻桥使用左右血缘区；多桥使用中间桥接带；密集交叉关系合并为血缘超组件。
11. 默认采用双层关系视图：当前家庭进入主体布局，历史配偶和非主父母关系进入辅助层。
12. 每个人物卡只显示一次。
13. 采用自研语义网格流水线，不依赖 ELK 或约束求解器输出最终坐标。

## 3. 目标

### 3.1 布局目标

- 夫妻始终是一个不可拆的家庭单元。
- 父代位于子代上方。
- 同父母子女连续排列。
- 同一血缘簇尽量紧凑。
- 不同血缘分量之间保留更大间距。
- 用户明确调整过的同代顺序优先保留。
- 相同输入必须产生相同输出。
- 新增或调整一个局部关系时，未关联分支尽量不移动。

### 3.2 连线目标

- 连线不能穿过人物卡片或家庭单元障碍区。
- 每条线路必须精确连接合法端口。
- 不得出现悬空端点。
- 不同家庭不得共享水平或垂直线段。
- 不同家庭不得形成视觉上类似汇合的 T 形接点。
- 同一家庭的多个孩子应共享主干和 bus。
- 无法消除的跨家庭交叉使用 line bridge 表示跨越，不表示连接。

### 3.3 交互目标

- 拖动夫妻中任意人物卡片时，整个家庭单元移动。
- 拖动期间使用浮层，不重复创建布局节点。
- 邻居家庭以插入式排序平滑让位。
- 第一版只允许同代横向拖拽。
- 放下后只重新计算直接受影响的代际和血缘块。
- 放下后不得出现二次跳动。

## 4. 非目标

- 第一版不支持任意自由坐标拖动。
- 第一版不支持把家庭单元拖到其他代。
- 第一版不支持整体拖动整棵后代分支。
- 第一版不在主体布局中同时展开全部历史婚姻。
- 第一版不复制人物卡来表达多个家庭。
- 第一版不追求任意关系图的通用自动排版。
- 第一版不引入 ILP、SMT 或其他全局约束求解器。

## 5. 第一性原则与约束优先级

家族关系不是普通树，而是包含伴侣、多人亲子关系和跨血缘婚姻的类型化图。排版引擎的职责是把事实投影成可读场景，不能为了排版改变事实。

当约束冲突时，使用以下固定优先级：

1. **语义正确：** 夫妻不可拆；父代在子代上方；人物不可丢失。
2. **几何安全：** 卡片不重叠；线路不穿卡；端点连续。
3. **线路归属：** 不同家庭不得共线或形成伪汇合。
4. **结构可读：** 同父母子女连续；同血缘成员尽量靠近。
5. **用户意图：** 保留用户明确的同代顺序。
6. **视觉稳定：** 未关联分支尽量保持原位。
7. **左右亲和：** 空间允许时保持双方血缘在夫妻两侧。
8. **画布紧凑：** 在前述约束满足后再压缩宽度和高度。

左右血缘区、紧凑度和画布尺寸都不是硬约束。它们不得破坏前三项。

## 6. 系统架构

布局引擎是与 Vue、Pinia 和 SVG 解耦的纯函数：

```ts
function layoutFamilyScene(request: LayoutRequest): LayoutScene
```

### 6.1 输入

```ts
interface LayoutRequest {
  facts: FamilyFacts
  view: FamilyViewPolicy
  preferences: LayoutPreferences
  metrics: LayoutMetrics
  previousScene?: LayoutScene
  changedIds?: string[]
}
```

### 6.2 流水线

```text
FactNormalizer
  → ViewProjector
  → FamilyUnitBuilder
  → GenerationAssigner
  → LineageClusterer
  → UnitOrderer
  → GridCompactor
  → FamilyLaneRouter
  → SceneValidator
```

每个阶段只负责一类问题，并返回不可变中间结果。

### 6.3 输出

```ts
interface LayoutScene {
  units: PlacedFamilyUnit[]
  cards: PlacedPersonCard[]
  hubs: PlacedUnionHub[]
  routes: RoutedFamilyEdge[]
  bounds: Rect
  diagnostics: LayoutDiagnostic[]
}
```

渲染层只读取 `LayoutScene`。拖拽层只产生 `LayoutPreferences`，不直接改写坐标。

## 7. 事实模型与视图投影

### 7.1 规范化事实

```ts
interface Person {
  id: string
}

interface Partnership {
  id: string
  partnerIds: string[]
  status: 'current' | 'historical'
}

interface Parentage {
  id: string
  parentIds: string[]
  childIds: string[]
  type: 'blood' | 'adopted' | 'step'
}
```

`Partnership` 和 `Parentage` 必须拥有稳定 ID。布局偏好不得使用临时坐标或数组下标作为身份。

### 7.2 默认视图

```ts
interface FamilyViewPolicy {
  primaryPartnershipByPerson: Record<string, string>
  primaryParentageByChild: Record<string, string>
  showHistoricalPartnerships: boolean
  showSecondaryParentage: boolean
  showGodparentRelations: boolean
}
```

规则：

- 每个人只进入一个主体 `FamilyUnit`。
- 当前主要配偶进入主体布局。
- 其他配偶关系进入辅助层。
- 每个孩子只有一个主要 `Parentage` 决定主体位置。
- 其他父母关系保留为辅助线。
- 干亲既不参与代际，也不参与血缘簇。
- 辅助层的开关不改变主体单元坐标，只重新路由辅助线。

### 7.3 多段配偶关系

事实模型允许一个人关联多段 `Partnership`。默认视图选择一段作为主要家庭，避免复制人物卡和多重拖拽归属。未被选为主要家庭的关系不会丢失。

## 8. 布局语义模型

```ts
interface FamilyUnit {
  id: string
  kind: 'single' | 'couple'
  memberIds: string[]
  generation: number
  widthInGrid: number
  lineageAffinity: Record<string, number>
}

interface ParentageGroup {
  id: string
  sourceUnitId: string
  childPersonIds: string[]
}

interface LineageCluster {
  id: string
  personIds: string[]
  unitIds: string[]
  kind: 'core' | 'bridge' | 'supercomponent'
}
```

### 8.1 FamilyUnit

- `couple` 包含两张人物卡、柔和底板、夫妻轴和 `UnionHub`。
- `single` 包含一张人物卡和必要的单亲 `ParentageHub`。
- 家庭单元内部坐标固定，外部布局只移动整个单元。
- `FamilyUnit.id` 来源于稳定关系 ID，而不是排序后的成员 ID 拼接。

### 8.2 ParentageGroup

- 两位主要父母时，线路从 `UnionHub` 发出。
- 单亲时，线路从人物卡底部的 `ParentageHub` 发出。
- 线路终点连接具体孩子的人物卡顶部端口。
- 如果孩子已经属于一个夫妻家庭单元，线路仍连接孩子本人的端口，不连接整个夫妻单元中心。

## 9. 代际计算

只使用主体 `Parentage` 计算代际：

```text
child.generation >= max(parent.generation) + 1
couple.memberA.generation = couple.memberB.generation
```

处理步骤：

1. 合并配偶同代约束。
2. 建立父母单元到孩子单元的有向图。
3. 使用强连通分量检测真实亲子环。
4. 无环时使用最长路径确定最低合法代际。
5. 对空缺代际进行压缩，但不能把父母与子女放到同一代。

真实家谱中同一祖先可通过多条路径到达，这属于 pedigree collapse，不等于亲子环。只有沿亲子方向回到自身才是错误数据。

发现亲子环时：

- 返回 `PARENTAGE_CYCLE` 诊断。
- 不修改事实数据。
- 把受影响节点放入独立错误组件，使用稳定网格降级展示。
- UI 提示用户修正关系。

## 10. 血缘亲和与边缘场景

### 10.1 血缘核心

血缘亲和主要来自 `blood` Parentage。养育和继亲关系仍保持结构邻近，但权重低于血缘亲和，避免将两个大血缘簇无条件合并。

### 10.2 自适应退化

#### 单一婚姻桥

- 左侧人物的血缘簇偏向家庭单元左侧。
- 右侧人物的血缘簇偏向右侧。
- 共同后代位于下方中心。

#### 多组交叉婚姻

例如同代两个 A 家子女分别与两个 B 家子女结婚：

- A、B 的血缘核心仍分别保持在外围。
- A×B 的跨血缘家庭单元进入中间桥接带。
- 桥接带允许多个家庭单元交错。
- 不再要求所有 A 人物连续或所有 B 人物连续。

#### 密集交叉关系

当桥接关系形成密集网络或多个循环：

- 合并为一个 `supercomponent`。
- 内部仍根据亲和权重形成局部簇。
- 放弃绝对左右承诺。
- 优先减少交叉、保持用户顺序和几何安全。

### 10.3 其他边缘场景

- **无配偶单亲：** 生成单人家庭单元和单亲汇合点。
- **当前配偶无共同子女：** 仍形成夫妻家庭单元，不生成父子主干。
- **离异后有共同子女：** 历史配偶进入辅助层；主要 Parentage 决定主体位置。
- **多人父母关系：** 主要 Parentage 进入主体；其他父母使用辅助线。
- **孤立成员：** 作为独立单人组件参与组件装箱。
- **多个不连通家族：** 分别布局后进行矩形装箱，组件间距大于家庭间距。
- **缺失引用：** 忽略无效边，保留有效人物并输出诊断。

## 11. 同代排序

排序单位是 `FamilyUnit`，不是人物卡。

### 11.1 硬规则

- 夫妻单元不可拆。
- 用户已确认的同代先后顺序不能被自动优化反转，除非它导致硬约束无法满足。

### 11.2 结构偏好

- 同一 Parentage 的孩子单元优先形成连续 block。
- 当孩子分别属于多个交叉婚姻家庭时，可以放松兄弟姐妹连续性。
- 父母家庭中心优先对齐孩子 block 中心。
- 血缘核心优先远离无关血缘块。

### 11.3 自动排序

1. 以出生日期和稳定 ID 建立初始顺序。
2. 把兄弟姐妹、夫妻和桥接家庭组织成不可拆 block。
3. 从父代向子代做 barycenter sweep。
4. 从子代向父代反向 sweep。
5. 重复固定轮数，默认 6 轮。
6. 每轮使用稳定 tie-breaker，防止相同分数时随机跳动。

评分函数按以下顺序比较：

1. 违反用户顺序的次数。
2. 主要父子线交叉数。
3. 血缘亲和距离。
4. 相对上一场景的位移。
5. 总体跨度。

不使用单个加权总分吞并所有目标，避免一个极端宽度收益覆盖语义约束。不同目标使用字典序比较。

## 12. 网格压缩

### 12.1 默认度量

```ts
interface LayoutMetrics {
  gridSize: 24
  cardWidth: 168
  cardHeight: 216
  spouseGap: 24
  familyGap: 72
  generationGap: 360
  routeSubgrid: 8
  cardClearance: 12
}
```

度量由布局请求提供，算法不得硬编码像素。

### 12.2 规则

- 单人单元默认占 7 个主网格。
- 夫妻单元默认占 15 个主网格。
- 家庭单元左边界吸附 24px 主网格。
- 连线使用 8px 子网格。
- 同代单元保持至少 72px 间距。
- 两代之间为线路 lane 保留动态高度。
- lane 不足时增加代际间距，不允许通过重合线路压缩高度。

### 12.3 压缩过程

1. 根据排序放置每行单位。
2. 计算每个 ParentageGroup 的理想中心。
3. 通过左右双向扫描满足最小间距。
4. 对家庭中心和子女 block 中心进行有限次数对齐。
5. 每次调整重新吸附主网格。
6. 独立组件完成后做矩形装箱。

## 13. 连线路由

连线路由在所有卡片坐标确定后独立执行。

### 13.1 路线身份

```ts
interface FamilyRouteRequest {
  routeOwnerId: string
  familyUnitId: string
  parentageId: string
  sourceHubId: string
  childCardIds: string[]
}
```

`routeOwnerId` 默认等于 `ParentageGroup.id`。只有相同 `routeOwnerId` 的线段可以合并。

### 13.2 端口

```ts
interface Port {
  id: string
  ownerId: string
  side: 'top' | 'bottom' | 'left' | 'right' | 'union'
  point: Point
}
```

- 夫妻轴连接两张卡片的内侧端口。
- `UnionHub` 位于夫妻轴中心。
- 父子主干从 `UnionHub` 向下。
- 单亲线路从人物卡底部汇合点向下。
- 子女线路进入孩子卡片顶部端口。
- 辅助关系优先使用左右端口，避免占用主体父子通道。

### 13.3 障碍物

人物卡和家庭底板都生成障碍矩形：

```text
cardObstacle = cardRect + cardClearance
unitObstacle = unitRect + unitClearance
```

除连接该线路自身 source 或 target port 的 terminal segment 外，任何线路不得进入障碍区。

### 13.4 家庭专属 lane

每个相邻代际之间建立独立 lane 空间。

对每个 ParentageGroup 计算水平 bus 区间：

```text
[minChildPortX, maxChildPortX]
```

分配规则：

1. 按区间跨度从大到小排序。
2. 在首个无冲突 lane 中放置。
3. 同一 lane 中，不同家庭的区间不得相交或相接。
4. 如果区间冲突，分配到下一条 lane。
5. 如果 lane 数量不足，扩大两代间距。

### 13.5 垂直线路

- 每条家庭主干和孩子下行线也注册到占用表。
- 不同家庭在相同 x 上存在重叠 y 区间时，使用 8px 子网格错开。
- 必要时从端口先走短水平 stub，再进入专属垂直子通道。
- 不同家庭不得共用垂直主干。

### 13.6 跨家庭重合检测

水平共线：

```text
sameY(a, b) && horizontalIntervalOverlap(a, b)
```

垂直共线：

```text
sameX(a, b) && verticalIntervalOverlap(a, b)
```

如果 `routeOwnerId` 不同，正长度重合即判为验证失败并重新路由。

不同家庭也不得形成 T 形接点：一条线路的端点不能落在另一家庭线段中间。

### 13.7 允许交叉

垂直线与水平线可以在一点相交，但必须使用 bridge 表示跨越：

- 交叉点不绘制汇合圆点。
- 稳定地选择其中一条线路绘制小拱桥。
- 选择规则使用 routeOwnerId 和 lane 顺序，保证每次结果一致。
- 只有真实 `UnionHub` 或 Parentage junction 才显示实心汇合标记。

### 13.8 家庭颜色

- 家庭底板使用 accent 约 6% 透明度。
- 家庭边框使用 accent 约 25% 透明度。
- 夫妻轴、UnionHub 和主体父子线路使用相同 accent。
- 相邻或线路相交的家庭优先分配不同颜色。
- 颜色分配结果按稳定家庭 ID 持久化，重新排版不变色。
- 颜色不是唯一编码；lane 分离、汇合点和 bridge 同时提供结构区分。
- 虚线保留给历史配偶、干亲和辅助父母关系，不用于区分普通主体家庭。

## 14. 拖拽与增量回流

### 14.1 拖拽对象

- 单人拖动 `PersonUnit`。
- 当前夫妻拖动整个 `FamilyUnit`。
- 夫妻内部人物卡没有独立拖动语义。
- 仅允许同代横向重排。

### 14.2 拖拽过程

1. 原位置保留半透明 placeholder。
2. 当前家庭使用 DragOverlay 跟随指针。
3. 根据家庭单元中心与其他单元边界计算插入索引。
4. 邻居单元通过 transform 动画实时让位。
5. 拖动期间只更新轻量关系预览，不执行完整路由。
6. 放下后提交完整同代顺序。
7. 对目标代、直接父代、直接子代和相关线路做增量计算。
8. 使用一次正式动画过渡到最终场景。

### 14.3 局部回流

- 被拖家庭位置视为强用户约束。
- 同代邻居允许漂移。
- 直接子女 block 允许小范围重新居中。
- 直接父母只在连线无法合法路由时小范围调整。
- 无关代际和不连通组件保持原位。

### 14.4 顺序持久化

不保存单个 slot 的数字 order，改为保存整行语义序列：

```ts
interface LayoutPreferences {
  rowOrders: RowOrderPreference[]
  familyAccentAssignments: Record<string, string>
}

interface RowOrderPreference {
  id: string
  unitIds: string[]
}
```

`rowOrders` 不使用代际数字作为持久化 key。新增更上层祖先可能让所有代际编号整体变化，因此恢复时按当前行和已保存 `unitIds` 的最大重合度匹配旧顺序。

关系变化后执行 reconciliation：

- 保留仍存在的家庭单元相对顺序。
- 删除失效单元。
- 新单元插入自动计算位置。
- 保存行与当前行没有有效成员重合时，丢弃该条偏好。
- 夫妻关系改变导致家庭单元 ID 变化时，尽量继承主要人物原有邻近位置。

## 15. 辅助关系层

辅助层包括：

- 历史配偶。
- 非主要父母关系。
- 干亲。
- 其他不参与主体布局的关系。

规则：

- 默认不影响主体位置。
- 默认可关闭；选中人物时可临时显示相关辅助关系。
- 使用灰色、紫色或关系专属虚线。
- 独立路由，不得与主体家庭线路共享线段。
- 必要时绕到组件外侧通道。
- 辅助关系过多时，优先只显示与当前选中人物相关的关系。

## 16. 视觉设计

### 16.1 家庭单元

- 柔和圆角底板。
- 两张独立白色人物卡。
- 配偶内侧端口由短夫妻轴连接。
- 中央菱形或圆形 UnionHub。
- 整体拖拽手柄位于家庭底板顶部或空白区域。
- 单击人物仍选择人物；拖动手柄或卡片空白处移动整个家庭。

### 16.2 图层

```text
背景网格              z = 0
主体普通线路          z = 5
辅助关系线路          z = 6
家庭单元底板          z = 10
人物卡片              z = 20
选中家庭高亮线路      z = 30
拖拽浮层              z = 40
```

普通线路永远位于人物卡片下方。选中高亮可以提高线路层级，但仍通过裁剪和障碍物规则避免覆盖卡片内容。

## 17. 诊断与降级

```ts
type LayoutDiagnosticCode =
  | 'MISSING_REFERENCE'
  | 'PARENTAGE_CYCLE'
  | 'INVALID_PRIMARY_PARTNERSHIP'
  | 'INVALID_PRIMARY_PARENTAGE'
  | 'UNROUTABLE_PRIMARY_EDGE'
  | 'CROSS_FAMILY_SEGMENT_OVERLAP'
  | 'NODE_OVERLAP'
```

原则：

- 数据错误不能导致整个画布空白。
- 有效成员必须继续显示。
- 无效偏好自动回退到稳定推断，并输出诊断。
- 主体线路无法合法路由时，优先增加间距并重排。
- 多次重排仍失败时，将受影响组件放到隔离区域，并展示诊断；不得输出悬空或错误连接。
- `SceneValidator` 在开发和测试中视硬约束失败为异常；生产环境返回安全降级场景。

## 18. 性能目标

目标规模为 500 位成员。

- 500 人完整初始布局：目标不超过 300ms。
- 普通家庭拖拽后的增量布局：目标不超过 100ms。
- 拖拽预览动画：目标保持 50–60 FPS。
- 相同输入多次运行结果必须完全一致。
- 未变化组件不重复执行排序和路由。

第一版保持核心引擎同步和纯函数化。`layoutFamilyScene` 外层保持异步接口并预留 Web Worker 边界。只有性能基准证明主线程不满足目标时才迁入 Worker，避免提前增加线程和序列化复杂度。

## 19. 测试策略

### 19.1 语义场景

- 单人。
- 当前夫妻无子女。
- 单亲带一个或多个子女。
- 标准三代家庭。
- 多兄弟姐妹及不同出生顺序。
- 离异、再婚和历史共同子女。
- 收养、继亲和非主父母关系。
- 两组兄弟姐妹交叉婚姻。
- 多组交叉婚姻桥接带。
- 密集交叉关系超组件。
- pedigree collapse。
- 真实亲子环错误。
- 多个不连通家族和孤立成员。
- 缺失引用和失效布局偏好。
- 500 人压力场景。

### 19.2 硬约束断言

```ts
expectEveryPersonRenderedOnce(scene)
expectNoCardOverlap(scene)
expectNoUnitOverlap(scene)
expectParentAboveChild(scene)
expectCoupleUnitIntact(scene)
expectEveryRouteEndpointAttached(scene)
expectNoEdgeIntersectsObstacle(scene)
expectNoCrossFamilySegmentOverlap(scene)
expectNoCrossFamilyTJunction(scene)
expectSameParentageMayShareBus(scene)
expectCrossingHasBridge(scene)
expectDeterministicLayout(scene)
```

### 19.3 稳定性断言

- 新增一个孩子不会移动不相关组件。
- 同代拖拽只改变目标行语义顺序。
- 直接子女局部回流不影响远端分支。
- 撤销拖拽恢复原顺序和坐标。
- 保存并重新打开项目后顺序和家庭颜色不变。

### 19.4 生成式测试

使用带固定随机种子的家族生成器构造合法家谱，覆盖：

- 1–500 人。
- 不同代际深度。
- 多子女和多次婚姻。
- 不连通组件。
- 多桥交叉婚姻。

每个生成场景执行全部几何与确定性断言。无需第一版引入新的 property-testing 依赖。

### 19.5 视觉验收

为关键场景生成固定尺寸截图：

- 家庭单元视觉。
- 多家庭 lane。
- line bridge。
- 多桥接血缘场景。
- 拖拽前、中、后状态。
- 辅助关系开关。

浏览器测试通过后，必须在 Tauri 实际窗口完成缩放、拖拽和大家族视觉验收。

## 20. 迁移策略

现有 V2 数据继续可读。

### 20.1 字段迁移

- `members` 和全部关系事实原样保留。
- `childLayoutAssignments` 转换为 `primaryParentageByChild` 的初始偏好。
- `gridLayoutOverrides` 按当前代际和 order 排序，尽力转换为 `rowOrders`。
- 已失效的 slot ID 忽略，不阻止加载。
- `manualPositions` 继续作为废弃兼容数据保留，不参与新布局。

### 20.2 引擎切换

1. 新引擎以独立模块实现。
2. 保持当前 grid engine 作为开发期回退。
3. 通过公共 facade 和同一批 fixture 对比两者。
4. 新引擎通过硬约束、视觉验收和 500 人基准后切换默认入口。
5. 稳定版本发布后再删除 ELK、旧 constraint 和旧 grid production path。

不在第一轮实现中同时删除旧引擎，以免排版重构和清理工作混在一起。

## 21. 推荐模块边界

```text
src/core/family-layout/
├── types.ts
├── normalizeFacts.ts
├── projectView.ts
├── buildFamilyUnits.ts
├── assignGenerations.ts
├── clusterLineages.ts
├── orderUnits.ts
├── compactGrid.ts
├── routeFamilyLanes.ts
├── routeAuxiliaryEdges.ts
├── reconcilePreferences.ts
├── validateScene.ts
└── layoutFamilyScene.ts

src/components/tree/
├── FamilyCanvas.vue
├── FamilyUnit.vue
├── PersonCard.vue
├── RelationLayer.vue
└── GridBackground.vue
```

每个核心文件只承担一个阶段。公共 API 只暴露 `types.ts` 和 `layoutFamilyScene.ts`。

## 22. 实施阶段

### 阶段 1：语义核心

- 新增事实投影、家庭单元和代际模型。
- 建立真实复杂 fixture。
- 完成语义与代际测试。

### 阶段 2：自动网格布局

- 实现血缘簇、桥接带、同代排序和网格压缩。
- 输出家庭单元和人物卡坐标。
- 完成无重叠与确定性验证。

### 阶段 3：主体连线路由

- 实现端口、障碍物、bus、lane、垂直子通道和 bridge。
- 完成跨家庭共线与 T 形检测。
- 解决当前连线覆盖、断开和穿卡问题。

### 阶段 4：家庭单元渲染

- 实现柔和底板、夫妻轴、UnionHub 和家庭颜色。
- 接入新 `LayoutScene`。

### 阶段 5：拖拽与增量回流

- 实现插入式网格拖拽、邻居漂移和局部回流。
- 迁移持久化顺序。

### 阶段 6：辅助关系与边缘场景

- 接入历史配偶、非主父母和干亲层。
- 完成多桥接、超组件和错误降级。

### 阶段 7：切换与清理

- 完成 500 人基准、浏览器截图和 Tauri 验收。
- 切换公共默认入口。
- 稳定后单独清理旧布局实现。

## 23. 完成标准

只有同时满足以下条件，项目才视为完成：

- 所有主体人物显示且只显示一次。
- 所有当前夫妻以家庭单元显示并整体拖动。
- 卡片与家庭单元零重叠。
- 主体父子线路零悬空、零穿卡。
- 不同家庭零共线段、零伪 T 形汇合。
- 同一家庭正确共享主干和子女 bus。
- 所有不可避免交叉都有明确 bridge。
- 同一血缘簇在软约束允许范围内保持紧凑。
- 多桥交叉婚姻和超组件可稳定布局。
- 拖拽后的同代顺序持久化且邻居平滑漂移。
- 500 人性能目标达到。
- 全量测试、类型检查、构建、浏览器视觉验收和 Tauri 实际窗口验收全部通过。
