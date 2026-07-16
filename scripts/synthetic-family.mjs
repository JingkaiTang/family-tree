export const SYNTHETIC_FAMILY_SEED = 20260716
export const SYNTHETIC_GENERATION_COUNTS = Object.freeze([12, 24, 36, 48, 48, 32])
export const SYNTHETIC_AVATARS_PER_GENERATION = 8

const SCHEMA_VERSION = 4
const BASE_BIRTH_YEARS = [1885, 1911, 1937, 1963, 1989, 2015]
const LAST_NAMES = [
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫',
  '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许', '何', '吕', '施', '张',
]
const GIVEN_NAMES = [
  '安然', '博文', '承宇', '诗涵', '晓峰', '雨桐', '佳宁', '明远',
  '子衡', '清和', '舒雅', '亦辰', '思源', '景行', '宜宁', '浩然',
  '若兰', '沐阳', '静姝', '嘉树', '知夏', '书恒', '云舒', '新月',
  '怀谨', '锦程', '映雪', '延年', '温言', '南星', '清扬', '晨曦',
]
const PLACES = ['苏州', '杭州', '南京', '成都', '西安', '武汉', '长沙', '青岛']
const OCCUPATIONS = [
  '教师', '医生', '工程师', '设计师', '会计', '农艺师', '编辑', '研究员',
]

export function syntheticFamily200(seed = SYNTHETIC_FAMILY_SEED) {
  const random = seededRandom(seed)
  const members = {}
  const cohorts = []
  const generationIndexes = Array(SYNTHETIC_GENERATION_COUNTS.length).fill(0)
  let nextMemberIndex = 0

  const createMember = (generation, role, rootId) => {
    const generationIndex = generationIndexes[generation]++
    nextMemberIndex += 1
    const id = `synthetic-g${generation + 1}-${String(generationIndex + 1).padStart(3, '0')}`
    const birthYear = BASE_BIRTH_YEARS[generation] + Math.floor(random() * 5)
    const month = String(1 + Math.floor(random() * 12)).padStart(2, '0')
    const day = String(1 + Math.floor(random() * 28)).padStart(2, '0')
    const gender = nextMemberIndex % 47 === 0
      ? 'other'
      : nextMemberIndex % 2 === 0 ? 'female' : 'male'
    const member = {
      id,
      firstName: GIVEN_NAMES[(nextMemberIndex * 7 + generationIndex) % GIVEN_NAMES.length],
      lastName: LAST_NAMES[(nextMemberIndex + generation * 3) % LAST_NAMES.length],
      nickname: generation >= 4 ? `小${GIVEN_NAMES[nextMemberIndex % GIVEN_NAMES.length].slice(-1)}` : undefined,
      gender,
      birthDate: `${birthYear}-${month}-${day}`,
      birthPlace: PLACES[(generationIndex + generation * 2) % PLACES.length],
      occupation: generation === 5
        ? '学生'
        : OCCUPATIONS[(generationIndex * 3 + generation) % OCCUPATIONS.length],
      education: generation <= 1 ? '家庭教育' : generation === 5 ? '在读' : '大专及以上',
      currentResidence: PLACES[(generationIndex * 5 + generation) % PLACES.length],
      notes: '虚构测试成员，不对应任何真实人物。',
      parents: [],
      children: [],
      siblings: [],
      spouses: [],
      godparents: [],
      godchildren: [],
      syntheticGeneration: generation,
      syntheticRole: role,
      syntheticRootId: rootId,
    }
    if (generation === 0) {
      member.deathDate = `${birthYear + 76 + Math.floor(random() * 10)}-${month}-${day}`
    } else if (generation === 1 && generationIndex % 3 === 0) {
      member.deathDate = `${birthYear + 73 + Math.floor(random() * 8)}-${month}-${day}`
    }
    members[id] = member
    return member
  }

  const founders = []
  const branches = []
  for (let rootIndex = 0; rootIndex < 6; rootIndex += 1) {
    const rootId = `root-family-${String(rootIndex + 1).padStart(2, '0')}`
    const left = createMember(0, 'founder', rootId)
    const right = createMember(0, 'founder', rootId)
    addSpouse(left, right, 'married')
    founders.push(left, right)
    branches.push({ id: rootId, couples: [[left, right]] })
  }
  cohorts.push(founders)

  const createChildren = (couples, count, generation) => {
    const orderedCouples = seededShuffle(couples, random)
    const childCounts = allocateEvenly(orderedCouples.length, count)
    return orderedCouples.flatMap((parents, coupleIndex) => (
      Array.from({ length: childCounts[coupleIndex] }, (_, childIndex) => {
        const rootId = combinedRootId(parents)
        const child = createMember(generation, 'descendant', rootId)
        child.lastName = parents[(childIndex + generation) % 2].lastName
        addParent(child, parents[0])
        addParent(child, parents[1])
        return child
      })
    ))
  }

  const pairWithIncoming = (descendants, generation, rootId) => descendants.map(descendant => {
    const incoming = createMember(generation, 'incoming-spouse', rootId)
    addSpouse(descendant, incoming, 'married')
    return { couple: [descendant, incoming], incoming }
  })

  for (const generation of [1, 2]) {
    const cohort = []
    const descendantCount = generation === 1 ? 2 : 3
    for (const branch of branches) {
      const descendants = createChildren(branch.couples, descendantCount, generation)
      const paired = pairWithIncoming(descendants, generation, branch.id)
      branch.couples = paired.map(value => value.couple)
      cohort.push(...descendants, ...paired.map(value => value.incoming))
    }
    cohorts.push(cohort)
  }

  const generation3 = []
  const crossRootPools = []
  const generation3Couples = []
  for (const branch of branches) {
    const descendants = createChildren(branch.couples, 5, 3)
    const localDescendants = descendants.slice(0, 3)
    const paired = pairWithIncoming(localDescendants, 3, branch.id)
    generation3Couples.push(...paired.map(value => value.couple))
    crossRootPools.push(descendants.slice(3))
    generation3.push(...descendants, ...paired.map(value => value.incoming))
  }
  for (let rootIndex = 0; rootIndex < branches.length; rootIndex += 2) {
    for (let index = 0; index < 2; index += 1) {
      const left = crossRootPools[rootIndex][index]
      const right = crossRootPools[rootIndex + 1][index]
      addSpouse(left, right, 'married')
      generation3Couples.push([left, right])
    }
  }
  cohorts.push(generation3)

  const generation4Descendants = createChildren(generation3Couples, 24, 4)
  const generation4Paired = generation4Descendants.map(descendant => {
    const incoming = createMember(4, 'incoming-spouse', descendant.syntheticRootId)
    addSpouse(descendant, incoming, 'married')
    return { couple: [descendant, incoming], incoming }
  })
  cohorts.push([
    ...generation4Descendants,
    ...generation4Paired.map(value => value.incoming),
  ])

  const generation5 = createChildren(
    generation4Paired.map(value => value.couple),
    SYNTHETIC_GENERATION_COUNTS[5],
    5,
  )
  cohorts.push(generation5)

  addStressRelations(cohorts, members)
  assignAvatarPool(cohorts, members)

  return {
    schemaVersion: SCHEMA_VERSION,
    members,
    nicknameOverrides: {},
    manualPositions: {},
    childLayoutAssignments: {},
    gridLayoutOverrides: {},
    layoutPreferences: {
      rootOrders: [],
      rowOrders: [],
      bridgeOrders: [],
      rootAccentAssignments: {},
      familyAccentAssignments: {},
    },
    rootMemberId: founders[0].id,
    defaultViewpointId: cohorts[3][Math.floor(cohorts[3].length / 2)].id,
  }
}

export function syntheticAvatarManifest(family) {
  const avatars = []
  for (let generation = 0; generation < SYNTHETIC_GENERATION_COUNTS.length; generation += 1) {
    for (let slot = 1; slot <= SYNTHETIC_AVATARS_PER_GENERATION; slot += 1) {
      const photoId = avatarId(generation, slot)
      avatars.push({
        photoId,
        generation: generation + 1,
        slot,
        memberIds: Object.values(family.members)
          .filter(member => member.photoId === photoId)
          .map(member => member.id),
      })
    }
  }
  return {
    kind: 'synthetic-avatar-pool',
    source: 'AI-generated fictional portrait atlas',
    columns: SYNTHETIC_AVATARS_PER_GENERATION,
    rows: SYNTHETIC_GENERATION_COUNTS.length,
    avatars,
  }
}

export function syntheticFamilyStats(family) {
  const members = Object.values(family.members)
  const generationCounts = Array(SYNTHETIC_GENERATION_COUNTS.length).fill(0)
  let marriedRefs = 0
  let divorcedRefs = 0
  let crossRootMarriedRefs = 0
  let adoptedRefs = 0
  let stepRefs = 0
  let godparentRefs = 0
  for (const member of members) {
    generationCounts[member.syntheticGeneration] += 1
    marriedRefs += member.spouses.filter(ref => ref.type === 'married').length
    divorcedRefs += member.spouses.filter(ref => ref.type === 'divorced').length
    crossRootMarriedRefs += member.spouses.filter(ref => (
      ref.type === 'married'
      && family.members[ref.id].syntheticRootId !== member.syntheticRootId
    )).length
    adoptedRefs += member.parents.filter(ref => ref.type === 'adopted').length
    stepRefs += member.parents.filter(ref => ref.type === 'step').length
    godparentRefs += member.godparents.length
  }
  return {
    memberCount: members.length,
    generationCounts,
    founderMemberCount: members.filter(member => member.syntheticRole === 'founder').length,
    incomingSpouseCount: members.filter(member => member.syntheticRole === 'incoming-spouse').length,
    rootFamilyCount: new Set(members
      .filter(member => member.syntheticRole === 'founder')
      .map(member => member.syntheticRootId)).size,
    currentCoupleCount: marriedRefs / 2,
    crossRootCurrentCoupleCount: crossRootMarriedRefs / 2,
    historicalCoupleCount: divorcedRefs / 2,
    adoptedParentRefCount: adoptedRefs,
    stepParentRefCount: stepRefs,
    godparentRefCount: godparentRefs,
    avatarCount: new Set(members.map(member => member.photoId)).size,
  }
}

function addStressRelations(cohorts, members) {
  setAllParentTypes(cohorts[4][0], members, 'adopted')

  const stepChild = cohorts[4][1]
  const stepParent = cohorts[3].find(candidate => (
    !stepChild.parents.some(parent => parent.id === candidate.id)
    && !stepChild.parents.some(parent => members[parent.id].spouses.some(spouse => spouse.id === candidate.id))
  ))
  addParent(stepChild, stepParent, 'step')

  addHistoricalSpouse(cohorts[3][0], cohorts[3], 7)
  addHistoricalSpouse(cohorts[4][3], cohorts[4], 11)

  addGodparent(cohorts[4][4], cohorts[2][0])
  addGodparent(cohorts[5][7], cohorts[3][3])
  addGodparent(cohorts[5][19], cohorts[3][14])
}

function assignAvatarPool(cohorts, members) {
  for (let generation = 0; generation < cohorts.length; generation += 1) {
    const usage = Array(SYNTHETIC_AVATARS_PER_GENERATION).fill(0)
    for (const member of cohorts[generation]) {
      const relatedIds = new Set(member.spouses.map(spouse => spouse.id))
      const parentIds = new Set(member.parents.map(parent => parent.id))
      for (const candidate of cohorts[generation]) {
        if (candidate.id === member.id) continue
        if (candidate.parents.some(parent => parentIds.has(parent.id))) relatedIds.add(candidate.id)
      }
      const forbidden = new Set([...relatedIds]
        .map(id => members[id]?.photoId)
        .filter(Boolean))
      const rankedSlots = Array.from(
        { length: SYNTHETIC_AVATARS_PER_GENERATION },
        (_, index) => index + 1,
      ).sort((left, right) => usage[left - 1] - usage[right - 1] || left - right)
      const slot = rankedSlots.find(value => !forbidden.has(avatarId(generation, value)))
        ?? rankedSlots[0]
      member.photoId = avatarId(generation, slot)
      usage[slot - 1] += 1
    }
  }
}

function addParent(child, parent, type = 'blood') {
  child.parents.push({ id: parent.id, type })
  parent.children.push({ id: child.id, type })
}

function addSpouse(left, right, type) {
  if (!left.spouses.some(spouse => spouse.id === right.id && spouse.type === type)) {
    left.spouses.push({ id: right.id, type })
  }
  if (!right.spouses.some(spouse => spouse.id === left.id && spouse.type === type)) {
    right.spouses.push({ id: left.id, type })
  }
}

function addHistoricalSpouse(member, cohort, offset) {
  const start = cohort.indexOf(member)
  for (let step = offset; step < cohort.length + offset; step += 1) {
    const candidate = cohort[(start + step) % cohort.length]
    if (candidate.id === member.id) continue
    if (member.spouses.some(spouse => spouse.id === candidate.id)) continue
    addSpouse(member, candidate, 'divorced')
    return
  }
  throw new Error(`Cannot find historical spouse for ${member.id}`)
}

function addGodparent(child, godparent) {
  child.godparents.push({ id: godparent.id, type: 'godparent' })
  godparent.godchildren.push({ id: child.id, type: 'godchild' })
}

function setAllParentTypes(child, members, type) {
  for (const parentRef of child.parents) {
    const parent = members[parentRef.id]
    const childRef = parent.children.find(ref => ref.id === child.id)
    parentRef.type = type
    childRef.type = type
  }
}

function allocateEvenly(groupCount, totalCount) {
  const base = Math.floor(totalCount / groupCount)
  const remainder = totalCount % groupCount
  return Array.from({ length: groupCount }, (_, index) => base + (index < remainder ? 1 : 0))
}

function combinedRootId(members) {
  return [...new Set(members.flatMap(member => member.syntheticRootId.split('+')))]
    .sort()
    .join('+')
}

function avatarId(generation, slot) {
  return `synthetic-avatar-g${generation + 1}-${String(slot).padStart(2, '0')}`
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function seededShuffle(values, random) {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}
