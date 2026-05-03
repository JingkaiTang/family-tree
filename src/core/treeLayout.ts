import type { Member } from './schema'

/**
 * 自定义分代家族树布局。
 *
 * 与 relatives-tree 相比，本布局能处理任意"跨婚姻连通"的家族图：所有成员只要
 * 通过父母/子女/配偶/兄弟姐妹的任意组合连通，都会出现在同一张图上。
 *
 * 核心概念：
 *   - generation (代数): 每人一个整数，配偶同代，父母 = 子女 - 1
 *   - couple (夫妻单元): 一对夫妻在同一代并排；无配偶者单独成单元
 *   - 每行 = 同代所有单元，按排序后顺序水平排列
 *
 * 输出坐标单位：cell（同 relatives-tree，消费方乘以 pitch 转像素）。
 */

// ---------- 输出类型 ----------

export interface LaidOutNode {
  id: string
  /** 节点"中心"的 x 坐标（单位：cell） */
  cx: number
  /** 节点"顶"的 y 坐标（单位：cell） */
  top: number
  generation: number
}

export interface Couple {
  /** 此代内的单元 id，用于内部索引 */
  id: string
  /** 夫妻成员的 id；单身或未成家时只有 1 个 */
  memberIds: string[]
  generation: number
  /** 排布后的中心 x 坐标 */
  cx: number
}

/** 一条连接线：支持折线。points 用于 SVG polyline。 */
export interface LayoutConnector {
  points: Array<{ x: number; y: number }>
  kind: 'parent-child' | 'spouse' | 'godparent'
}

export interface LayoutResult {
  nodes: LaidOutNode[]
  couples: Couple[]
  connectors: LayoutConnector[]
  canvas: { width: number; height: number }
  orphanIds: string[] // 理论为空；保留字段兼容早期调用方
  /**
   * 最终坐标平移量 = -minX：算法内部坐标减去 offsetX 后被整体左移到画布 [0, width]。
   * 调用方把"屏幕 px 反算回存储用的 manualPosition.cx"时需要加回 offsetX。
   */
  offsetX: number
}

// ---------- 参数（单位：cell） ----------

const NODE_W = 2 // 每个节点占 2 格宽
const NODE_H = 4 // 每个节点占 4 格高（110×55 = 节点宽；4×55=220 覆盖 210px 节点）
const COUPLE_GAP = 0.2 // 夫妻间距
const UNIT_GAP = 1.5 // 不同单元之间的水平间距
const ROW_GAP = 3 // 相邻代之间的留白（给连线的多轨道用）
const ROW_HEIGHT = NODE_H + ROW_GAP // = 7 cell = 385px

// ---------- 主入口 ----------

export function layoutFamilyTree(
  members: Member[],
  opts?: { manualPositions?: Record<string, { cx: number; top: number }> },
): LayoutResult {
  if (members.length === 0) {
    return {
      nodes: [],
      couples: [],
      connectors: [],
      canvas: { width: 0, height: 0 },
      orphanIds: [],
      offsetX: 0,
    }
  }

  const byId = new Map(members.map((m) => [m.id, m]))

  // Step 1: 给每人分配 generation
  const gen = assignGenerations(members, byId)

  // Step 2: 按代分组
  const byGen = new Map<number, Member[]>()
  for (const m of members) {
    const g = gen.get(m.id)!
    if (!byGen.has(g)) byGen.set(g, [])
    byGen.get(g)!.push(m)
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b)

  // Step 3: 每代内组成 couples（夫妻单元）
  const couplesByGen = new Map<number, Couple[]>()
  for (const g of gens) {
    couplesByGen.set(g, buildCouples(byGen.get(g)!, byId, gen))
  }

  // Step 4: 排序每代 couples
  //   - 顶代：按"孩子数+姓名"稳定排序
  //   - 下一代：按"父母 couple 的 cx 平均值"排序，形成上下对应
  // Step 5: 给每代赋 x 坐标（居中于子女之上 / 子女居中于父母之下）
  // 多次迭代收敛
  initialPlacement(gens, couplesByGen, byId, gen)
  // 只做一次 relax：向上让子女对齐父母中点（这是最自然的家族树视觉），
  // 不做"向下移动父母"——repack 只能单向挤，反复迭代会让整图漂移。
  relaxUpward(gens, couplesByGen, byId)
  // 最后对齐独生子女 ↔ 父母：让单子女链的横线彻底消失
  alignOnlyChildren(gens, couplesByGen, byId)

  // Step 6: 把 couple 的 cx 分解到各成员
  const nodes: LaidOutNode[] = []
  const minGen = gens[0]
  for (const g of gens) {
    for (const c of couplesByGen.get(g)!) {
      c.memberIds.forEach((id, idx) => {
        const offset = couplePairOffset(c.memberIds.length, idx)
        nodes.push({
          id,
          cx: c.cx + offset,
          top: (g - minGen) * ROW_HEIGHT,
          generation: g,
        })
      })
    }
  }

  // Step 6.5: 用户手工拖动过的节点 → 用保存的位置覆盖算法布局。
  // 连线在 Step 7 里基于 node.cx / node.top 绘制，因此连线会自动跟随手工位置。
  const manual = opts?.manualPositions
  if (manual) {
    for (const n of nodes) {
      const m = manual[n.id]
      if (m) {
        n.cx = m.cx
        n.top = m.top
      }
    }
  }

  // Step 7: 连线
  const connectors = buildConnectors(nodes, couplesByGen, byId)

  // Step 8: 画布尺寸
  let minX = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - NODE_W / 2)
    maxX = Math.max(maxX, n.cx + NODE_W / 2)
    maxY = Math.max(maxY, n.top + NODE_H)
  }
  // 把坐标平移到 >= 0。offsetX 记录这次的平移量，给调用方反算用。
  const dx = -minX
  for (const n of nodes) n.cx += dx
  for (const c of connectors) c.points.forEach((p) => (p.x += dx))
  for (const g of gens) for (const c of couplesByGen.get(g)!) c.cx += dx

  return {
    nodes,
    couples: gens.flatMap((g) => couplesByGen.get(g)!),
    connectors,
    canvas: {
      width: maxX - minX,
      height: maxY,
    },
    orphanIds: [],
    offsetX: dx,
  }
}

// ---------- Step 1: 分代 BFS ----------

function assignGenerations(
  members: Member[],
  byId: Map<string, Member>,
): Map<string, number> {
  const gen = new Map<string, number>()

  // 对每个连通分量独立跑 BFS：不同分量之间互不影响代数。
  // 每个分量以"任一无 parents 的成员"为 0 代；若没有就用第一个成员。
  const bfs = (startId: string, startGen: number) => {
    const queue: string[] = [startId]
    gen.set(startId, startGen)
    while (queue.length > 0) {
      const id = queue.shift()!
      const g = gen.get(id)!
      const m = byId.get(id)
      if (!m) continue
      const push = (otherId: string, otherGen: number) => {
        if (!byId.has(otherId)) return
        if (gen.has(otherId)) return
        gen.set(otherId, otherGen)
        queue.push(otherId)
      }
      for (const p of m.parents) push(p.id, g - 1)
      for (const c of m.children) push(c.id, g + 1)
      for (const s of m.spouses) push(s.id, g)
      for (const s of m.siblings) push(s.id, g)
      // 干亲：干爹/干妈视同父母代（高一代），干儿子/干女儿视同子女代（低一代）
      for (const p of m.godparents) push(p.id, g - 1)
      for (const c of m.godchildren) push(c.id, g + 1)
    }
  }

  for (const m of members) {
    if (gen.has(m.id)) continue
    // 在本分量内找一个"无 parents"的成员当 0 代起点；否则就用 m 自己
    const componentSeed = findTopInComponent(m.id, byId) ?? m.id
    bfs(componentSeed, 0)
  }

  return gen
}

/** 在包含 seedId 的连通分量内，找一个没有 parents 的成员；若找不到返回 null。 */
function findTopInComponent(
  seedId: string,
  byId: Map<string, Member>,
): string | null {
  const seen = new Set<string>([seedId])
  const queue: string[] = [seedId]
  let best: string | null = null
  while (queue.length > 0) {
    const id = queue.shift()!
    const m = byId.get(id)
    if (!m) continue
    if (m.parents.length === 0) {
      if (best === null || id < best) best = id // id 字典序稳定挑选
    }
    for (const r of [...m.parents, ...m.children, ...m.spouses, ...m.siblings, ...m.godparents, ...m.godchildren]) {
      if (!seen.has(r.id) && byId.has(r.id)) {
        seen.add(r.id)
        queue.push(r.id)
      }
    }
  }
  return best
}

// ---------- Step 3: 配偶单元 ----------

function buildCouples(
  membersInGen: Member[],
  byId: Map<string, Member>,
  gen: Map<string, number>,
): Couple[] {
  const used = new Set<string>()
  const couples: Couple[] = []
  const thisGen = gen.get(membersInGen[0].id)!

  // 优先按"是否有子女"把有子女的夫妻先配对（让主干更清晰）
  const sorted = [...membersInGen].sort((a, b) => {
    const ca = a.children.length
    const cb = b.children.length
    return cb - ca
  })

  for (const m of sorted) {
    if (used.has(m.id)) continue
    const spouseInGen = m.spouses
      .map((s) => byId.get(s.id))
      .find((sp) => sp && !used.has(sp.id) && gen.get(sp.id) === thisGen)
    if (spouseInGen) {
      // 让男方在左、女方在右（如果有一男一女）；否则原序
      let pair = [m.id, spouseInGen.id]
      if (m.gender === 'female' && spouseInGen.gender === 'male') {
        pair = [spouseInGen.id, m.id]
      }
      used.add(m.id)
      used.add(spouseInGen.id)
      couples.push({
        id: pair.join('|'),
        memberIds: pair,
        generation: thisGen,
        cx: 0,
      })
    } else {
      used.add(m.id)
      couples.push({
        id: m.id,
        memberIds: [m.id],
        generation: thisGen,
        cx: 0,
      })
    }
  }
  return couples
}

// 返回 couple 中第 idx 个成员相对 couple.cx 的偏移
function couplePairOffset(size: number, idx: number): number {
  if (size === 1) return 0
  // 两人并排：左 = -(NODE_W+COUPLE_GAP)/2，右 = +(NODE_W+COUPLE_GAP)/2
  const half = (NODE_W + COUPLE_GAP) / 2
  return idx === 0 ? -half : +half
}

function coupleWidth(c: Couple): number {
  return c.memberIds.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W
}

// ---------- Step 4-5: 排序 + 赋 x 坐标 ----------

function parentsOf(m: Member, byId: Map<string, Member>): Member[] {
  return m.parents
    .map((p) => byId.get(p.id))
    .filter((x): x is Member => !!x)
}

/** 某个 couple 的"父母参照 x"：取两位成员的父母 couples 的 cx 平均 */
function parentRefX(
  c: Couple,
  byId: Map<string, Member>,
  coupleOfMember: Map<string, Couple>,
): number | null {
  const xs: number[] = []
  for (const mid of c.memberIds) {
    const m = byId.get(mid)
    if (!m) continue
    for (const p of parentsOf(m, byId)) {
      const pc = coupleOfMember.get(p.id)
      if (pc) xs.push(pc.cx)
    }
  }
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * 某个 couple 的"主父母 couple"。
 * 规则：按 memberIds 顺序（通常男左女右）找第一位有 parents 的成员，
 * 以那位的第一对父母作为主父母。没有父母则返回 null。
 *
 * 这个锚点的作用：同一父母生的多兄弟姐妹各自结婚后组成的 couple，
 * 都会以这对主父母 cx 作为起始位置，再由 repack 紧贴排在一起——
 * 从而保证兄弟姐妹视觉上是连续的一段，而不是被各自的姻亲家长辈拉散。
 */
function primaryParentCouple(
  c: Couple,
  byId: Map<string, Member>,
  coupleOfMember: Map<string, Couple>,
): Couple | null {
  for (const mid of c.memberIds) {
    const m = byId.get(mid)
    if (!m) continue
    for (const p of m.parents) {
      const pc = coupleOfMember.get(p.id)
      if (pc) return pc
    }
  }
  return null
}

/** （保留）某个 couple 的"子女参照 x"：取该单元所有子女的 couples 的 cx 平均 */
function childRefX(
  c: Couple,
  byId: Map<string, Member>,
  coupleOfMember: Map<string, Couple>,
): number | null {
  const xs: number[] = []
  const seenCouples = new Set<string>()
  for (const mid of c.memberIds) {
    const m = byId.get(mid)
    if (!m) continue
    for (const ch of m.children) {
      const cc = coupleOfMember.get(ch.id)
      if (cc && !seenCouples.has(cc.id)) {
        seenCouples.add(cc.id)
        xs.push(cc.cx)
      }
    }
  }
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
// 保留导出以避免误删（未来布局升级可能用到）
void childRefX

/** 把一代 couples 按给定 cx 排序后，重新贴合避免重叠（保持相对顺序） */
function repack(couples: Couple[]) {
  couples.sort((a, b) => a.cx - b.cx)
  let cursor = -Infinity
  for (const c of couples) {
    const w = coupleWidth(c)
    const leftMin = cursor + UNIT_GAP + w / 2
    if (c.cx < leftMin) c.cx = leftMin
    cursor = c.cx + w / 2
  }
}

function initialPlacement(
  gens: number[],
  couplesByGen: Map<number, Couple[]>,
  byId: Map<string, Member>,
  _gen: Map<string, number>,
) {
  // 顶代：按 id 顺序排
  const topGen = gens[0]
  const topCouples = couplesByGen.get(topGen)!
  topCouples.sort((a, b) => a.id.localeCompare(b.id))
  let x = 0
  for (const c of topCouples) {
    const w = coupleWidth(c)
    c.cx = x + w / 2
    x += w + UNIT_GAP
  }

  // 下面几代：把同一"主父母"生的兄弟姐妹连续摆在一起。
  // 策略：
  //   1) 每代 couples 按 (主父母 cx, 是否姻亲入赘的 couple, 原 id) 排序。
  //      主父母 cx 相同的 couples 必然是亲兄弟姐妹 → 排序后它们在数组里连续。
  //   2) 以主父母 cx 作为初始 x。主父母相同的兄弟姐妹初始位置重合，
  //      repack 会按相对顺序把它们挤开紧贴，不会让姻亲家族插进来。
  //   3) 没有主父母的 couple（顶代"嫁入"的外家长辈但没录父母）
  //      用上一位置 + UNIT_GAP 作为后备 x。
  const coupleOfMember = buildCoupleIndex(couplesByGen)
  for (let i = 1; i < gens.length; i++) {
    const g = gens[i]
    const cps = couplesByGen.get(g)!

    // 计算每个 couple 的主父母参考；用于排序和赋初始 x
    const anchor = new Map<string, number | null>()
    for (const c of cps) {
      const pp = primaryParentCouple(c, byId, coupleOfMember)
      anchor.set(c.id, pp ? pp.cx : null)
    }

    // 排序：主父母 cx 升序（无主父母的排到最后）；同主父母按原 id 保持稳定
    cps.sort((a, b) => {
      const ax = anchor.get(a.id)
      const bx = anchor.get(b.id)
      if (ax == null && bx == null) return a.id.localeCompare(b.id)
      if (ax == null) return 1
      if (bx == null) return -1
      if (ax !== bx) return ax - bx
      return a.id.localeCompare(b.id)
    })

    let fallbackX = 0
    for (const c of cps) {
      const ax = anchor.get(c.id)
      c.cx = ax ?? fallbackX
      fallbackX = c.cx + coupleWidth(c) + UNIT_GAP
    }
    repack(cps)
  }
}

function buildCoupleIndex(
  couplesByGen: Map<number, Couple[]>,
): Map<string, Couple> {
  const idx = new Map<string, Couple>()
  for (const cps of couplesByGen.values()) {
    for (const c of cps) {
      for (const mid of c.memberIds) idx.set(mid, c)
    }
  }
  return idx
}

function relaxUpward(
  gens: number[],
  couplesByGen: Map<number, Couple[]>,
  byId: Map<string, Member>,
) {
  const coupleOfMember = buildCoupleIndex(couplesByGen)

  // 策略：把同一"主父母"的兄弟姐妹当成一个"兄弟块"，
  //       整块居中于主父母 cx，块内保持当前排序紧贴排列。
  //       没有主父母的 couple 各自为块。
  //       再按块的目标 center 排序，从左到右分配实际 x，避免相互重叠。
  for (let i = gens.length - 1; i > 0; i--) {
    const cps = couplesByGen.get(gens[i])!
    if (cps.length === 0) continue

    interface Block {
      /** 块的目标中心 x（主父母 cx 或孤立 couple 原 cx） */
      center: number
      /** 组内 couples，按当前 cx 相对顺序 */
      couples: Couple[]
      /** 总宽度：sum(coupleWidth) + (n-1) * UNIT_GAP */
      width: number
      /** 稳定排序辅助键 */
      tieBreak: string
    }
    const groups = new Map<string, Block>()
    const blocks: Block[] = []

    for (const c of cps) {
      const pp = primaryParentCouple(c, byId, coupleOfMember)
      if (pp) {
        let g = groups.get(pp.id)
        if (!g) {
          g = { center: pp.cx, couples: [], width: 0, tieBreak: pp.id }
          groups.set(pp.id, g)
          blocks.push(g)
        }
        g.couples.push(c)
      } else {
        blocks.push({
          center: c.cx,
          couples: [c],
          width: coupleWidth(c),
          tieBreak: c.id,
        })
      }
    }

    // 组内按现有 cx 排序，保持 initialPlacement 时确立的相对顺序
    for (const blk of blocks) {
      if (blk.couples.length > 1) {
        blk.couples.sort((a, b) => a.cx - b.cx || a.id.localeCompare(b.id))
      }
      blk.width = blk.couples.reduce(
        (s, c, idx) => s + coupleWidth(c) + (idx > 0 ? UNIT_GAP : 0),
        0,
      )
    }

    // 按目标中心排序；中心相同则按 tieBreak 保持稳定
    blocks.sort((a, b) => a.center - b.center || a.tieBreak.localeCompare(b.tieBreak))

    // 左到右铺开：块整体居中于 center，但不能与左邻重叠
    let cursor = -Infinity
    for (const blk of blocks) {
      let leftEdge = blk.center - blk.width / 2
      if (leftEdge < cursor + UNIT_GAP) leftEdge = cursor + UNIT_GAP
      let px = leftEdge
      for (const c of blk.couples) {
        const w = coupleWidth(c)
        c.cx = px + w / 2
        px += w + UNIT_GAP
      }
      cursor = px - UNIT_GAP
    }
  }
}

/** （保留）旧 API：同代全成员按父母平均 cx 对齐。已由 relaxUpward 新版替代。 */
function _legacyRelaxUpward(
  gens: number[],
  couplesByGen: Map<number, Couple[]>,
  byId: Map<string, Member>,
) {
  const coupleOfMember = buildCoupleIndex(couplesByGen)
  for (let i = gens.length - 1; i > 0; i--) {
    const cps = couplesByGen.get(gens[i])!
    for (const c of cps) {
      const parentX = parentRefX(c, byId, coupleOfMember)
      if (parentX != null) c.cx = parentX
    }
    repack(cps)
  }
}
void _legacyRelaxUpward

/** 旧的双向 relax 已移除：它会让 repack 的单向挤压持续向右漂移整图。 */

/**
 * 最终一轮"独生子女对齐"：仅自底向上处理。
 * 规则：若一对父母只生了 1 个孩子，且该孩子只有这一对父母 → 父母 cx = 孩子 cx。
 * 这样独生子女场景下，父母↔子女的横线被完全消除。
 * 姻亲场景（孩子有两对父母）不处理，让孩子保持在两对父母中点。
 */
function alignOnlyChildren(
  gens: number[],
  couplesByGen: Map<number, Couple[]>,
  byId: Map<string, Member>,
) {
  const coupleOfMember = buildCoupleIndex(couplesByGen)

  for (let i = gens.length - 2; i >= 0; i--) {
    const g = gens[i]
    const cps = couplesByGen.get(g)!
    for (const c of cps) {
      const childSet = new Set<string>()
      for (const mid of c.memberIds) {
        const m = byId.get(mid)
        if (!m) continue
        for (const ch of m.children) childSet.add(ch.id)
      }
      if (childSet.size !== 1) continue
      const onlyChildId = [...childSet][0]
      const child = byId.get(onlyChildId)
      const childCouple = coupleOfMember.get(onlyChildId)
      if (!child || !childCouple) continue
      // 孩子只有这对父母 → 贴齐，无横线
      if (child.parents.length <= 1) {
        c.cx = childCouple.cx
      }
    }
    repack(cps)
  }
}

// ---------- Step 7: 连线 ----------

function buildConnectors(
  nodes: LaidOutNode[],
  couplesByGen: Map<number, Couple[]>,
  byId: Map<string, Member>,
): LayoutConnector[] {
  const lines: LayoutConnector[] = []
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // 配偶连线（水平短线）——在节点垂直中心
  for (const cps of couplesByGen.values()) {
    for (const c of cps) {
      if (c.memberIds.length === 2) {
        const a = nodeById.get(c.memberIds[0])!
        const b = nodeById.get(c.memberIds[1])!
        const y = a.top + NODE_H / 2
        lines.push({
          kind: 'spouse',
          points: [
            { x: a.cx, y },
            { x: b.cx, y },
          ],
        })
      }
    }
  }

  // 父母 → 子女折线：先收集每代里的"家族单元"（父母 couple + 子女节点组），
  // 再按 x 范围做"轨道着色"（区间图贪心上色），不同轨道分配不同 y，
  // 避免多对父母的横线叠在同一条 y 上合并成视觉噪音。
  interface FamilyUnit {
    parentY: number // 父母节点底边 y
    parentX: number // 横线起点/父母出线点
    childTop: number // 子女顶边 y
    children: LaidOutNode[]
    minX: number // 横线最左 x
    maxX: number // 横线最右 x
    /** 父母的 generation，用于按代分组 */
    genKey: number
  }
  const units: FamilyUnit[] = []

  for (const cps of couplesByGen.values()) {
    for (const c of cps) {
      const childIdsSet = collectChildren(c, byId)
      if (childIdsSet.size === 0) continue
      const parentNodes = c.memberIds
        .map((id) => nodeById.get(id))
        .filter((n): n is LaidOutNode => !!n)
      if (parentNodes.length === 0) continue
      const childNodes = [...childIdsSet]
        .map((id) => nodeById.get(id))
        .filter((n): n is LaidOutNode => !!n)
      if (childNodes.length === 0) continue

      const parentY = parentNodes[0].top + NODE_H
      const parentX =
        parentNodes.length === 2
          ? (parentNodes[0].cx + parentNodes[1].cx) / 2
          : parentNodes[0].cx
      const childTop = childNodes[0].top
      const xs = childNodes.map((n) => n.cx)
      units.push({
        parentY,
        parentX,
        childTop,
        children: childNodes,
        minX: Math.min(parentX, ...xs),
        maxX: Math.max(parentX, ...xs),
        genKey: parentNodes[0].generation,
      })
    }
  }

  // 按代分组并分配 y 轨道
  const unitsByGen = new Map<number, FamilyUnit[]>()
  for (const u of units) {
    if (!unitsByGen.has(u.genKey)) unitsByGen.set(u.genKey, [])
    unitsByGen.get(u.genKey)!.push(u)
  }

  for (const groupUnits of unitsByGen.values()) {
    // 区间贪心着色：按 minX 排序，给每个 unit 分配最小可用 track（当前 tracks 没人
    // 或上一个占用 track 的 unit 已经结束）
    const sorted = [...groupUnits].sort((a, b) => a.minX - b.minX)
    const trackEndX: number[] = [] // 每条 track 上最后一个 unit 的 maxX
    const trackOf = new Map<FamilyUnit, number>()
    for (const u of sorted) {
      let assigned = -1
      for (let t = 0; t < trackEndX.length; t++) {
        if (trackEndX[t] + 0.3 < u.minX) {
          assigned = t
          break
        }
      }
      if (assigned === -1) {
        assigned = trackEndX.length
        trackEndX.push(u.maxX)
      } else {
        trackEndX[assigned] = u.maxX
      }
      trackOf.set(u, assigned)
    }

    const totalTracks = trackEndX.length
    // 在 parentY 与 childTop 之间给每条轨道分配一个 y
    for (const u of groupUnits) {
      const t = trackOf.get(u)!
      const gap = u.childTop - u.parentY
      const margin = gap * 0.15
      const usable = gap - 2 * margin
      // 单轨道放中点；多轨道按 (t+0.5)/N 比例均分
      const frac = totalTracks <= 1 ? 0.5 : (t + 0.5) / totalTracks
      const midY = u.parentY + margin + usable * frac

      const childXs = u.children.map((c) => c.cx)
      const childMin = Math.min(...childXs)
      const childMax = Math.max(...childXs)
      const EPS = 1e-6

      // 1) 父母中点向下到 midY
      lines.push({
        kind: 'parent-child',
        points: [
          { x: u.parentX, y: u.parentY },
          { x: u.parentX, y: midY },
        ],
      })

      // 2) 水平段：只在需要时画，且范围限定在"真正要连的"区间
      //    - 单子女 + x 对齐：无需横线
      //    - 单子女 + x 不齐：只画父母↔子女那一段
      //    - 多子女：覆盖子女范围；父母在外再补一段桥接
      if (u.children.length >= 2) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: childMin, y: midY },
            { x: childMax, y: midY },
          ],
        })
        if (u.parentX < childMin - EPS) {
          lines.push({
            kind: 'parent-child',
            points: [
              { x: u.parentX, y: midY },
              { x: childMin, y: midY },
            ],
          })
        } else if (u.parentX > childMax + EPS) {
          lines.push({
            kind: 'parent-child',
            points: [
              { x: childMax, y: midY },
              { x: u.parentX, y: midY },
            ],
          })
        }
      } else {
        const cn = u.children[0]
        if (Math.abs(cn.cx - u.parentX) > EPS) {
          const left = Math.min(u.parentX, cn.cx)
          const right = Math.max(u.parentX, cn.cx)
          lines.push({
            kind: 'parent-child',
            points: [
              { x: left, y: midY },
              { x: right, y: midY },
            ],
          })
        }
      }

      // 3) 每个子女从 midY 下降到顶边
      for (const cn of u.children) {
        lines.push({
          kind: 'parent-child',
          points: [
            { x: cn.cx, y: midY },
            { x: cn.cx, y: cn.top },
          ],
        })
      }
    }
  }

  // 干亲连线（godparent → godchild）：从父母代节点底部直连子女代节点顶部。
  // 风格上由渲染层画成虚线；算法不做轨道分配（社会关系少，简单直连即可）。
  const emittedGod = new Set<string>()
  for (const n of nodes) {
    const m = byId.get(n.id)
    if (!m) continue
    for (const gc of m.godchildren) {
      const key = `${n.id}>${gc.id}`
      if (emittedGod.has(key)) continue
      emittedGod.add(key)
      const target = nodeById.get(gc.id)
      if (!target) continue
      lines.push({
        kind: 'godparent',
        points: [
          { x: n.cx, y: n.top + NODE_H },
          { x: target.cx, y: target.top },
        ],
      })
    }
  }

  // 使用 members 做断言，避免未使用警告
  void byId
  return lines
}

function collectChildren(c: Couple, byId: Map<string, Member>): Set<string> {
  const set = new Set<string>()
  for (const mid of c.memberIds) {
    const m = byId.get(mid)
    if (!m) continue
    for (const ch of m.children) set.add(ch.id)
  }
  return set
}
