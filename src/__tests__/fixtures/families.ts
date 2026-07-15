/**
 * 共享测试 fixture — 多套预定义家族结构，供 L2/L3 测试复用
 */
import { createEmptyFamily, type FamilyData, type Member } from '@/core/schema'

/** 快速构造最小 Member 对象 */
export function mk(
  id: string,
  opts: {
    gender?: Member['gender']
    firstName?: string
    lastName?: string
    birthDate?: string
  } = {},
): Member {
  return {
    id,
    firstName: opts.firstName ?? id,
    lastName: opts.lastName ?? '',
    gender: opts.gender ?? 'other',
    birthDate: opts.birthDate,
    parents: [],
    children: [],
    siblings: [],
    spouses: [],
    godparents: [],
    godchildren: [],
  }
}

/** 建立双向亲子关系 */
export function addParent(child: Member, parent: Member, type: 'blood' | 'adopted' | 'step' = 'blood') {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}

/** 建立双向配偶关系 */
export function addSpouse(a: Member, b: Member) {
  a.spouses.push({ id: b.id, type: 'married' })
  b.spouses.push({ id: a.id, type: 'married' })
}

/** 建立双向兄弟姐妹关系 */
export function addSibling(a: Member, b: Member) {
  a.siblings.push({ id: b.id, type: 'blood' })
  b.siblings.push({ id: a.id, type: 'blood' })
}

// ============ 预定义家族结构 ============

/**
 * 经典三代同堂 (7人)
 *
 *   爷爷(gpa)──奶奶(gma)     外公(mgp)──外婆(mgm)
 *         │                        │
 *         └────父亲(dad)──母亲(mom)─┘
 *                   │
 *                自己(self)
 */
export function threeGenFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    self: mk('self', { gender: 'male' }),
    dad: mk('dad', { gender: 'male' }),
    mom: mk('mom', { gender: 'female' }),
    gpa: mk('gpa', { gender: 'male' }),
    gma: mk('gma', { gender: 'female' }),
    mgp: mk('mgp', { gender: 'male' }),
    mgm: mk('mgm', { gender: 'female' }),
  }
  addParent(m.self, m.dad)
  addParent(m.self, m.mom)
  addParent(m.dad, m.gpa)
  addParent(m.dad, m.gma)
  addParent(m.mom, m.mgp)
  addParent(m.mom, m.mgm)
  addSpouse(m.dad, m.mom)
  addSpouse(m.gpa, m.gma)
  addSpouse(m.mgp, m.mgm)
  return m
}

/**
 * 核心成员数组版（供 relativesAdapter 测试使用）
 */
export function threeGenMemberArray(): Member[] {
  return Object.values(threeGenFamily())
}

/**
 * 带兄弟姐妹的四代结构 (15+人)
 * 覆盖：兄弟、姐妹、堂亲、表亲、叔伯、姑姑、舅舅、姨
 */
export function extendedFamily(): Record<string, Member> {
  const m = threeGenFamily()

  // self 的兄弟和姐妹
  m.bro = mk('bro', { gender: 'male' })
  m.sis = mk('sis', { gender: 'female' })
  addParent(m.bro, m.dad)
  addParent(m.bro, m.mom)
  addParent(m.sis, m.dad)
  addParent(m.sis, m.mom)
  addSibling(m.self, m.bro)
  addSibling(m.self, m.sis)

  // dad 的兄弟 (叔叔) 和姐妹 (姑姑)
  m.uncle_p = mk('uncle_p', { gender: 'male' })
  m.aunt_p = mk('aunt_p', { gender: 'female' })
  addParent(m.uncle_p, m.gpa)
  addParent(m.uncle_p, m.gma)
  addParent(m.aunt_p, m.gpa)
  addParent(m.aunt_p, m.gma)
  addSibling(m.dad, m.uncle_p)
  addSibling(m.dad, m.aunt_p)

  // mom 的兄弟 (舅舅) 和姐妹 (姨)
  m.uncle_m = mk('uncle_m', { gender: 'male' })
  m.aunt_m = mk('aunt_m', { gender: 'female' })
  addParent(m.uncle_m, m.mgp)
  addParent(m.uncle_m, m.mgm)
  addParent(m.aunt_m, m.mgp)
  addParent(m.aunt_m, m.mgm)
  addSibling(m.mom, m.uncle_m)
  addSibling(m.mom, m.aunt_m)

  return m
}

export function multiUnionFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    parentA: mk('parentA', { gender: 'male' }),
    parentB: mk('parentB', { gender: 'female' }),
    parentC: mk('parentC', { gender: 'female' }),
    childAB1: mk('childAB1', { gender: 'male', birthDate: '2000-01-01' }),
    childAB2: mk('childAB2', { gender: 'female', birthDate: '2002-01-01' }),
    childAC: mk('childAC', { gender: 'male', birthDate: '2010-01-01' }),
    stranger: mk('stranger', { gender: 'other' }),
  }
  addSpouse(m.parentA, m.parentB)
  m.parentA.spouses.push({ id: m.parentC.id, type: 'divorced' })
  m.parentC.spouses.push({ id: m.parentA.id, type: 'divorced' })
  addParent(m.childAB1, m.parentA)
  addParent(m.childAB1, m.parentB)
  addParent(m.childAB2, m.parentA)
  addParent(m.childAB2, m.parentB)
  addParent(m.childAC, m.parentA)
  addParent(m.childAC, m.parentC)
  return m
}

export function multiHistoricalUnionFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    parentA: mk('parentA', { gender: 'male' }),
    parentB: mk('parentB', { gender: 'female' }),
    parentC: mk('parentC', { gender: 'female' }),
    parentD: mk('parentD', { gender: 'female' }),
    childAB: mk('childAB', { birthDate: '2000-01-01' }),
    childAC: mk('childAC', { birthDate: '2005-01-01' }),
    childAD: mk('childAD', { birthDate: '2010-01-01' }),
  }
  addSpouse(m.parentA, m.parentB)
  for (const historicalPartner of [m.parentC, m.parentD]) {
    m.parentA.spouses.push({ id: historicalPartner.id, type: 'divorced' })
    historicalPartner.spouses.push({ id: m.parentA.id, type: 'divorced' })
  }
  addParent(m.childAB, m.parentA)
  addParent(m.childAB, m.parentB)
  addParent(m.childAC, m.parentA)
  addParent(m.childAC, m.parentC)
  addParent(m.childAD, m.parentA)
  addParent(m.childAD, m.parentD)
  return m
}

/** 两个血缘核心中的两对兄弟姐妹交叉结婚。 */
export function crossMarriedSiblingsFamily(): Record<string, Member> {
  const m = siblingCorePair(2)
  addSpouse(m['a-child-1'], m['b-child-1'])
  addSpouse(m['a-child-2'], m['b-child-2'])
  return m
}

/** 两个血缘核心之间有三组婚姻桥，形成 dense supercomponent。 */
export function denseBridgeFamily(): Record<string, Member> {
  const m = siblingCorePair(3)
  addSpouse(m['a-child-1'], m['b-child-1'])
  addSpouse(m['a-child-2'], m['b-child-2'])
  addSpouse(m['a-child-3'], m['b-child-3'])
  return m
}

/** 单根三代，第二代包含两个夫妻家庭和多个子女。 */
export function singleRootThreeGenerationFamily(): Record<string, Member> {
  const members = Object.fromEntries([
    'root-a', 'root-b',
    'branch-a', 'branch-a-spouse', 'branch-b', 'branch-b-spouse',
    'grandchild-a-1', 'grandchild-a-2', 'grandchild-b-1',
  ].map(id => [id, mk(id)]))
  addSpouse(members['root-a'], members['root-b'])
  for (const branchId of ['branch-a', 'branch-b']) {
    addParent(members[branchId], members['root-a'])
    addParent(members[branchId], members['root-b'])
    addSpouse(members[branchId], members[`${branchId}-spouse`])
  }
  for (const childId of ['grandchild-a-1', 'grandchild-a-2']) {
    addParent(members[childId], members['branch-a'])
    addParent(members[childId], members['branch-a-spouse'])
  }
  addParent(members['grandchild-b-1'], members['branch-b'])
  addParent(members['grandchild-b-1'], members['branch-b-spouse'])
  return members
}

/** 三个可见根通过 A-B、B-C 两组婚姻形成链。 */
export function threeRootChainFamily(): Record<string, Member> {
  const members = threeRootCores(2)
  addSpouse(members['a-child-1'], members['b-child-1'])
  addSpouse(members['b-child-2'], members['c-child-1'])
  return members
}

/** 三个可见根通过 A-B、B-C、C-A 三组婚姻形成环。 */
export function threeRootRingFamily(): Record<string, Member> {
  const members = threeRootCores(2)
  addSpouse(members['a-child-1'], members['b-child-1'])
  addSpouse(members['b-child-2'], members['c-child-1'])
  addSpouse(members['c-child-2'], members['a-child-2'])
  return members
}

/** {A,B} 与 {B,C} 的后代结婚，下一代根签名应为 {A,B,C}。 */
export function overlappingRootSignatureFamily(): Record<string, Member> {
  const members = threeRootCores(2)
  const ab = mk('ab-child')
  const bc = mk('bc-child')
  const abc = mk('abc-child')
  addSpouse(members['a-child-1'], members['b-child-1'])
  addParent(ab, members['a-child-1'])
  addParent(ab, members['b-child-1'])
  addSpouse(members['b-child-2'], members['c-child-1'])
  addParent(bc, members['b-child-2'])
  addParent(bc, members['c-child-1'])
  addSpouse(ab, bc)
  addParent(abc, ab)
  addParent(abc, bc)
  members[ab.id] = ab
  members[bc.id] = bc
  members[abc.id] = abc
  return members
}

/** 没有上游祖先的嫁入/娶入成员不应成为独立根。 */
export function incomingSpouseFamily(): Record<string, Member> {
  const members = Object.fromEntries([
    'root-a', 'root-b', 'descendant', 'incoming', 'child',
  ].map(id => [id, mk(id)]))
  addSpouse(members['root-a'], members['root-b'])
  addParent(members.descendant, members['root-a'])
  addParent(members.descendant, members['root-b'])
  addSpouse(members.descendant, members.incoming)
  addParent(members.child, members.descendant)
  addParent(members.child, members.incoming)
  return members
}

/** 两侧祖先记录深度不一致，但双方仍各自保留可见根。 */
export function unequalDepthRootsFamily(): Record<string, Member> {
  const members = Object.fromEntries([
    'a-root-a', 'a-root-b', 'a-middle', 'a-child',
    'b-root-a', 'b-root-b', 'b-child',
  ].map(id => [id, mk(id)]))
  addSpouse(members['a-root-a'], members['a-root-b'])
  addParent(members['a-middle'], members['a-root-a'])
  addParent(members['a-middle'], members['a-root-b'])
  addParent(members['a-child'], members['a-middle'])
  addSpouse(members['b-root-a'], members['b-root-b'])
  addParent(members['b-child'], members['b-root-a'])
  addParent(members['b-child'], members['b-root-b'])
  addSpouse(members['a-child'], members['b-child'])
  return members
}

/** 收养参与主根签名；继亲、历史配偶和干亲只进入辅助层。 */
export function auxiliaryRelationsFamily(): Record<string, Member> {
  const members = Object.fromEntries([
    'parent-a', 'parent-b', 'historical', 'step-parent',
    'blood-child', 'adopted-child', 'godparent',
  ].map(id => [id, mk(id)]))
  addSpouse(members['parent-a'], members['parent-b'])
  members['parent-a'].spouses.push({ id: 'historical', type: 'divorced' })
  members.historical.spouses.push({ id: 'parent-a', type: 'divorced' })
  addParent(members['blood-child'], members['parent-a'])
  addParent(members['blood-child'], members['parent-b'])
  addParent(members['blood-child'], members['step-parent'], 'step')
  addParent(members['adopted-child'], members['parent-a'], 'adopted')
  addParent(members['adopted-child'], members['parent-b'], 'adopted')
  members['blood-child'].godparents.push({ id: 'godparent', type: 'godparent' })
  members.godparent.godchildren.push({ id: 'blood-child', type: 'godchild' })
  return members
}

export function twoRootMarriageFamilyData(): FamilyData {
  const members: Record<string, Member> = {
    'a-root-a': mk('a-root-a'),
    'a-root-b': mk('a-root-b'),
    'a-child': mk('a-child'),
    'b-root-a': mk('b-root-a'),
    'b-root-b': mk('b-root-b'),
    'b-child': mk('b-child'),
    'joint-child': mk('joint-child'),
  }
  addSpouse(members['a-root-a'], members['a-root-b'])
  addParent(members['a-child'], members['a-root-a'])
  addParent(members['a-child'], members['a-root-b'])
  addSpouse(members['b-root-a'], members['b-root-b'])
  addParent(members['b-child'], members['b-root-a'])
  addParent(members['b-child'], members['b-root-b'])
  addSpouse(members['a-child'], members['b-child'])
  addParent(members['joint-child'], members['a-child'])
  addParent(members['joint-child'], members['b-child'])
  return { ...createEmptyFamily(), members }
}

export function twoDisconnectedRootComponents(): FamilyData {
  const members: Record<string, Member> = {
    a: mk('a'),
    'a-root-a': mk('a-root-a'),
    'a-root-b': mk('a-root-b'),
    b: mk('b'),
    'b-root-a': mk('b-root-a'),
    'b-root-b': mk('b-root-b'),
  }
  addSpouse(members['a-root-a'], members['a-root-b'])
  addParent(members.a, members['a-root-a'])
  addParent(members.a, members['a-root-b'])
  addSpouse(members['b-root-a'], members['b-root-b'])
  addParent(members.b, members['b-root-a'])
  addParent(members.b, members['b-root-b'])
  return { ...createEmptyFamily(), members }
}

/** 同一祖先经两条合法血缘路径到达同一后代，但不存在亲子环。 */
export function pedigreeCollapseFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    ancestor: mk('ancestor', { birthDate: '1930-01-01' }),
    branchA: mk('branch-a', { birthDate: '1955-01-01' }),
    branchB: mk('branch-b', { birthDate: '1957-01-01' }),
    cousinA: mk('cousin-a', { birthDate: '1980-01-01' }),
    cousinB: mk('cousin-b', { birthDate: '1982-01-01' }),
    descendant: mk('descendant', { birthDate: '2005-01-01' }),
  }
  addParent(m.branchA, m.ancestor)
  addParent(m.branchB, m.ancestor)
  addParent(m.cousinA, m.branchA)
  addParent(m.cousinB, m.branchB)
  addSpouse(m.cousinA, m.cousinB)
  addParent(m.descendant, m.cousinA)
  addParent(m.descendant, m.cousinB)
  return m
}

/** 最小亲子环：两人互为对方父母。 */
export function parentageCycleFamily(): Record<string, Member> {
  const m: Record<string, Member> = {
    'cycle-a': mk('cycle-a'),
    'cycle-b': mk('cycle-b'),
  }
  addParent(m['cycle-a'], m['cycle-b'])
  addParent(m['cycle-b'], m['cycle-a'])
  return m
}

/** 多个互不相连、处于相同两代的四口之家。 */
export function manySameGenerationFamilies(count: number): Record<string, Member> {
  const members: Record<string, Member> = {}
  for (let index = 1; index <= Math.max(0, Math.floor(count)); index++) {
    const prefix = `family-${String(index).padStart(4, '0')}`
    const parentA = mk(`${prefix}-parent-a`, { birthDate: '1970-01-01' })
    const parentB = mk(`${prefix}-parent-b`, { birthDate: '1972-01-01' })
    const childA = mk(`${prefix}-child-a`, { birthDate: '2000-01-01' })
    const childB = mk(`${prefix}-child-b`, { birthDate: '2002-01-01' })
    addSpouse(parentA, parentB)
    addParent(childA, parentA)
    addParent(childA, parentB)
    addParent(childB, parentA)
    addParent(childB, parentB)
    for (const member of [parentA, parentB, childA, childB]) {
      members[member.id] = member
    }
  }
  return members
}

/**
 * 稳定的大型谱系：本地 seeded LCG 决定配对顺序与成员属性。
 * 每个新成员只连接上一代父母；每组 parentage 最多四个孩子。
 */
export function largeFamily(seed: number, memberCount: number): Record<string, Member> {
  const total = Math.max(0, Math.floor(memberCount))
  const members: Record<string, Member> = {}
  if (total === 0) return members

  const random = seededRandom(seed)
  let nextIndex = 1
  const createPerson = (generation: number): Member => {
    const id = `person-${String(nextIndex++).padStart(4, '0')}`
    const year = 1720 + generation * 24 + Math.floor(random() * 5)
    const month = String(1 + Math.floor(random() * 12)).padStart(2, '0')
    const day = String(1 + Math.floor(random() * 28)).padStart(2, '0')
    const person = mk(id, {
      gender: random() < 0.5 ? 'female' : 'male',
      birthDate: `${year}-${month}-${day}`,
    })
    members[id] = person
    return person
  }

  const founderLimit = Math.min(total, 24)
  const founderCount = founderLimit === 1 ? 1 : founderLimit - founderLimit % 2
  const founders = Array.from({ length: founderCount }, () => createPerson(0))
  let currentCouples = pairFounders(founders, random)
  let generation = 1

  while (nextIndex <= total && currentCouples.length > 0) {
    const targetSize = Math.min(48, total - nextIndex + 1)
    const childCounts = allocateChildCounts(currentCouples.length, targetSize, random)
    const childGroups = currentCouples.flatMap((parents, parentageIndex) => {
      const children = Array.from({ length: childCounts[parentageIndex] }, () => {
        const child = createPerson(generation)
        addParent(child, parents[0])
        addParent(child, parents[1])
        return child
      })
      return children.length === 0
        ? []
        : [{ id: parentageKey(parents), children }]
    })
    currentCouples = pairAcrossParentages(childGroups, random)
    generation++
  }
  return members
}

function siblingCorePair(childCount: number): Record<string, Member> {
  const members: Record<string, Member> = {}
  for (const core of ['a', 'b']) {
    const parentA = mk(`${core}-parent-a`, { birthDate: '1950-01-01' })
    const parentB = mk(`${core}-parent-b`, { birthDate: '1952-01-01' })
    addSpouse(parentA, parentB)
    members[parentA.id] = parentA
    members[parentB.id] = parentB
    for (let index = 1; index <= childCount; index++) {
      const child = mk(`${core}-child-${index}`, {
        birthDate: `${1975 + index}-01-01`,
      })
      addParent(child, parentA)
      addParent(child, parentB)
      members[child.id] = child
    }
  }
  return members
}

function threeRootCores(childCount: number): Record<string, Member> {
  const members: Record<string, Member> = {}
  for (const rootId of ['a', 'b', 'c']) {
    const parentA = mk(`${rootId}-root-a`)
    const parentB = mk(`${rootId}-root-b`)
    addSpouse(parentA, parentB)
    members[parentA.id] = parentA
    members[parentB.id] = parentB
    for (let index = 1; index <= childCount; index += 1) {
      const child = mk(`${rootId}-child-${index}`)
      addParent(child, parentA)
      addParent(child, parentB)
      members[child.id] = child
    }
  }
  return members
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pairFounders(founders: Member[], random: () => number): Array<[Member, Member]> {
  const shuffled = seededShuffle(founders, random)
  const couples: Array<[Member, Member]> = []
  for (let index = 0; index + 1 < shuffled.length; index += 2) {
    addSpouse(shuffled[index], shuffled[index + 1])
    couples.push([shuffled[index], shuffled[index + 1]])
  }
  return couples
}

function allocateChildCounts(
  parentageCount: number,
  childCount: number,
  random: () => number,
): number[] {
  const counts = Array(parentageCount).fill(0) as number[]
  const order = seededShuffle(
    Array.from({ length: parentageCount }, (_, index) => index),
    random,
  )
  if (childCount === parentageCount * 4) {
    order.forEach(index => { counts[index] = 4 })
    return counts
  }
  if (childCount % 2 === 0 && childCount / 2 <= parentageCount) {
    order.slice(0, childCount / 2).forEach(index => { counts[index] = 2 })
    return counts
  }
  for (let index = 0; index < childCount; index++) {
    counts[order[index % order.length]]++
  }
  return counts
}

function pairAcrossParentages(
  groups: Array<{ id: string; children: Member[] }>,
  random: () => number,
): Array<[Member, Member]> {
  if (groups.length < 2) return []
  const ordered = seededShuffle(groups, random).map(group => ({
    ...group,
    children: seededShuffle(group.children, random),
  }))
  const uniformSize = ordered[0].children.length
  if (
    uniformSize % 2 === 0
    && ordered.every(group => group.children.length === uniformSize)
  ) {
    const half = uniformSize / 2
    const couples: Array<[Member, Member]> = []
    for (let groupIndex = 0; groupIndex < ordered.length; groupIndex++) {
      const nextGroup = ordered[(groupIndex + 1) % ordered.length]
      for (let childIndex = 0; childIndex < half; childIndex++) {
        const left = ordered[groupIndex].children[childIndex]
        const right = nextGroup.children[half + childIndex]
        addSpouse(left, right)
        couples.push([left, right])
      }
    }
    return couples
  }

  const pending = seededShuffle(
    ordered.flatMap(group => group.children.map(child => ({ child, groupId: group.id }))),
    random,
  )
  const couples: Array<[Member, Member]> = []
  while (pending.length > 1) {
    const left = pending.shift()!
    const rightIndex = pending.findIndex(value => value.groupId !== left.groupId)
    if (rightIndex < 0) break
    const [right] = pending.splice(rightIndex, 1)
    addSpouse(left.child, right.child)
    couples.push([left.child, right.child])
  }
  return couples
}

function parentageKey(parents: [Member, Member]): string {
  return parents.map(parent => parent.id).sort().join('+')
}

function seededShuffle<T>(values: T[], random: () => number): T[] {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}
