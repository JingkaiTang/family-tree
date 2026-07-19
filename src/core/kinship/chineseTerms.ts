import type { Member, SiblingOrders } from '@/core/schema'
import { compareSiblingOrderIds } from '@/core/siblingOrder'
import type { PathStep, RelType } from './pathFinder'

type TargetGender = 'male' | 'female' | 'other'

/**
 * 把规范化后的路径翻译成中文称呼。
 *
 * 路径只含 parent/child/spouse（sibling 已展开为 parent+child）。
 *
 * 策略（按优先级）：
 * 1. 全是 parent → 直系祖先
 * 2. 全是 child → 直系后代
 * 3. 含有 sibling（未展开）→ 兜底
 * 4. parent+ 然后 child+（无 spouse）→ 旁系
 * 5. 末尾 spouse（仅1个spouse）→ 姻亲后缀（某亲属的配偶）
 * 6. 开头 spouse（仅1个spouse）→ 姻亲前缀（配偶的亲属）
 * 7. 两端 spouse（2个spouse）→ 妯娌/连襟等
 * 8. 其他 → 回退为“远房亲戚”
 *
 * 父系/母系判定：看第一步 parent 走向的是男还是女（toGender）
 * 长幼判定：优先使用同父母组共享顺序，再比较 birthDate；均不可用时回退到合并标签
 */

export function describeRelation(
  path: PathStep[],
  selfId: string,
  targetId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders = {},
): string {
  if (path.length === 0) return '自己'
  if (selfId === targetId) return '自己'

  const kinds = path.map((s) => s.kind)
  const target = members[targetId]
  const targetGender: TargetGender = target?.gender ?? 'other'
  const selfMember = members[selfId]
  const selfGender: TargetGender = selfMember?.gender ?? 'other'

  // --- 配偶 ---
  if (kinds.length === 1 && kinds[0] === 'spouse') {
    if (path[0].relType === 'divorced') {
      if (targetGender === 'female') return '前妻'
      if (targetGender === 'male') return '前夫'
      return '前配偶'
    }
    if (targetGender === 'female') return '妻子'
    if (targetGender === 'male') return '丈夫'
    return '配偶'
  }

  // --- 直系祖先：parent × N ---
  if (kinds.every((k) => k === 'parent')) {
    return ancestorLabel(path, targetGender, members)
  }

  // --- 直系后代：child × N ---
  if (kinds.every((k) => k === 'child')) {
    return descendantLabel(path, targetGender, members)
  }

  // --- 含有未展开的 sibling 边 ---
  if (kinds.includes('sibling')) {
    return siblingFallbackLabel(path, targetGender, selfId, members, siblingOrders)
  }

  // --- 旁系：先若干 parent，然后若干 child（中间不能有 spouse）---
  const firstChildIdx = kinds.indexOf('child')
  const lastParentIdx = kinds.lastIndexOf('parent')
  const noSpouse = !kinds.includes('spouse')
  if (
    noSpouse &&
    firstChildIdx > 0 &&
    lastParentIdx < firstChildIdx &&
    kinds.slice(0, firstChildIdx).every((k) => k === 'parent') &&
    kinds.slice(firstChildIdx).every((k) => k === 'child')
  ) {
    const up = firstChildIdx
    const down = kinds.length - firstChildIdx
    const paternal = path[0].toGender === 'male'
    return collateralLabel(
      up,
      down,
      paternal,
      targetGender,
      path,
      selfId,
      members,
      siblingOrders,
    )
  }

  // --- 末尾是 spouse 的姻亲（路径中仅1个spouse）---
  const spouseCount = kinds.filter((k) => k === 'spouse').length
  if (kinds[kinds.length - 1] === 'spouse' && spouseCount === 1) {
    const innerPath = path.slice(0, -1)
    const innerTargetId = innerPath[innerPath.length - 1].toId
    const innerLabel = describeRelation(
      innerPath,
      selfId,
      innerTargetId,
      members,
      siblingOrders,
    )
    return inLawByInner(innerLabel, targetGender, path[path.length - 1].relType)
  }

  // --- 开头是 spouse 的姻亲（路径中仅1个spouse）---
  if (kinds[0] === 'spouse' && spouseCount === 1) {
    const innerPath = path.slice(1)
    const innerTargetId = innerPath[innerPath.length - 1].toId
    const innerLabel = describeRelation(
      innerPath,
      path[0].toId,
      innerTargetId,
      members,
      siblingOrders,
    )
    return viaSpouseLabel(innerLabel, targetGender, selfGender)
  }

  // --- 两端 spouse 或多处 spouse → 妯娌/连襟等 ---
  if (spouseCount >= 2) {
    return multiSpouseLabel(path)
  }

  // 回退
  return '远房亲戚'
}

// ==================== 年龄比较工具 ====================

type AgeOrder = 'older' | 'younger' | 'unknown'

function compareAge(a: Member | undefined, b: Member | undefined): AgeOrder {
  if (!a?.birthDate || !b?.birthDate) return 'unknown'
  if (a.birthDate < b.birthDate) return 'older'
  if (a.birthDate > b.birthDate) return 'younger'
  return 'unknown'
}

function compareAgeById(
  aId: string,
  bId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): AgeOrder {
  const siblingOrder = compareSiblingOrderIds(aId, bId, siblingOrders)
  if (siblingOrder !== null) return siblingOrder < 0 ? 'older' : 'younger'
  return compareAge(members[aId], members[bId])
}

// ==================== 直系 ====================

function ancestorLabel(path: PathStep[], targetGender: TargetGender, members: Record<string, Member>): string {
  const n = path.length
  const paternalFirst = path[0].toGender === 'male'

  if (n === 1) {
    if (path[0].relType === 'step') {
      return targetGender === 'female' ? '继母' : '继父'
    }
    if (path[0].relType === 'adopted') {
      return targetGender === 'female' ? '养母' : '养父'
    }
    return targetGender === 'female' ? '母亲' : '父亲'
  }
  if (n === 2) {
    return paternalFirst
      ? (targetGender === 'female' ? '奶奶' : '爷爷')
      : (targetGender === 'female' ? '外婆' : '外公')
  }
  if (n === 3) {
    return paternalFirst
      ? (targetGender === 'female' ? '曾祖母' : '曾祖父')
      : (targetGender === 'female' ? '外曾祖母' : '外曾祖父')
  }
  if (n === 4) {
    return paternalFirst
      ? (targetGender === 'female' ? '高祖母' : '高祖父')
      : (targetGender === 'female' ? '外高祖母' : '外高祖父')
  }
  return `${n}代以上${paternalFirst ? '' : '外'}先人`
}

function descendantLabel(path: PathStep[], targetGender: TargetGender, members: Record<string, Member>): string {
  const n = path.length

  // 检查路径中是否经过女性（除目标外），用于区分孙子/外孙
  const goesThroughFemale = path.some((step, i) => {
    if (i === path.length - 1) return false // 跳过目标
    return step.toGender === 'female'
  })

  if (n === 1) {
    if (path[0].relType === 'adopted') {
      return targetGender === 'female' ? '养女' : '养子'
    }
    if (path[0].relType === 'step') {
      return targetGender === 'female' ? '继女' : '继子'
    }
    return targetGender === 'female' ? '女儿' : '儿子'
  }
  if (n === 2) {
    if (goesThroughFemale) {
      return targetGender === 'female' ? '外孙女' : '外孙'
    }
    return targetGender === 'female' ? '孙女' : '孙子'
  }
  if (n === 3) {
    if (goesThroughFemale) {
      return targetGender === 'female' ? '外曾孙女' : '外曾孙'
    }
    return targetGender === 'female' ? '曾孙女' : '曾孙'
  }
  if (n === 4) {
    if (goesThroughFemale) {
      return targetGender === 'female' ? '外玄孙女' : '外玄孙'
    }
    return targetGender === 'female' ? '玄孙女' : '玄孙'
  }
  return `${goesThroughFemale ? '外' : ''}${n}代以下晚辈`
}

// ==================== 旁系 ====================

/**
 * 旁系称呼。
 *
 * 关键概念：
 * - up = 从 self 到共同祖先的 parent 步数
 * - down = 从共同祖先到目标的 child 步数
 * - genDiff = up - down = 代际差（正=长辈，负=晚辈，0=同辈）
 * - paternal = 第一步 parent 走向的是否为男性（决定父系/母系大方向）
 * - 分叉点性别 = path[up] 的 toGender（从共同祖先往下的第一步），
 *   决定这一支是走儿子（堂）还是女儿（表）
 *
 * 堂/表判定规则：
 * - 分叉点是男性 → 堂系（同姓）
 * - 分叉点是女性 → 表系（异姓）
 * - 特例：up=1,down=1 时，分叉点就是父母，此时用 paternal 判定
 *   因为如果第一步走父亲→共同祖先→兄弟，分叉点就是父亲（男）= 堂=亲兄弟
 */
function collateralLabel(
  up: number,
  down: number,
  paternal: boolean,
  targetGender: TargetGender,
  path: PathStep[],
  selfId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): string {
  const genDiff = up - down  // 代际差：正=长辈，0=同辈，负=晚辈

  // 分叉点：从共同祖先往下的第一步 = path[up]
  // 同辈一代表亲只有“父亲的兄弟子女”算堂，其余姑舅姨子女都算表。
  // 更远的父母表/堂辈仍保留原有按分叉性别区分的规则。
  const branchIsMale = up === 1
    ? paternal
    : (up < path.length ? path[up].toGender === 'male' : true)
  const sameGenerationTang = collateralPrefixIsTang(up, paternal, branchIsMale)

  // --- 同辈：genDiff === 0 ---
  if (genDiff === 0) {
    if (up === 1) {
      // 兄弟姐妹
      const selfVsTarget = compareAgeById(targetId(path), selfId, members, siblingOrders)
      return siblingLabel(targetGender, selfVsTarget, path[1]?.relType)
    }
    if (up === 2) {
      const prefix = sameGenerationTang ? '堂' : '表'
      const ageOrder = compareAgeById(targetId(path), selfId, members, siblingOrders)
      if (targetGender === 'female') {
        if (ageOrder === 'older') return `${prefix}姐`
        if (ageOrder === 'younger') return `${prefix}妹`
        return `${prefix}姐妹`
      } else {
        if (ageOrder === 'older') return `${prefix}兄`
        if (ageOrder === 'younger') return `${prefix}弟`
        return `${prefix}兄弟`
      }
    }
    return (sameGenerationTang ? '远房堂' : '远房表') + (targetGender === 'female' ? '姐妹' : '兄弟')
  }

  // --- 长辈旁系：genDiff > 0 ---
  if (genDiff > 0) {
    // 父母辈（genDiff=1）
    if (genDiff === 1) {
      if (up === 2 && down === 1) {
        // 父母的兄弟姐妹
        if (paternal) {
          if (targetGender === 'female') return '姑姑'
          return unclePaternalLabel(path, selfId, members, siblingOrders)
        }
        return targetGender === 'female' ? '姨' : '舅舅'
      }
      // up=3,down=2 等其他 genDiff=1 的组合
      // 例如：父亲的表兄弟（up=3,down=2）
      return collateralUncleLabel(
        paternal,
        branchIsMale,
        targetGender,
        path,
        selfId,
        members,
        siblingOrders,
      )
    }

    // 祖父母辈（genDiff=2）
    if (genDiff === 2) {
      if (up === 3 && down === 1) {
        return grandCollateralLabel(path, paternal, targetGender, members, siblingOrders)
      }
      // 祖辈的堂/表兄弟姐妹（如：up=4,down=2）
      const prefix = branchIsMale ? '堂' : '表'
      if (paternal) {
        return targetGender === 'female' ? `${prefix}姑奶奶` : `${prefix}叔公`
      }
      return targetGender === 'female' ? `${prefix}姨姥` : `${prefix}舅姥爷`
    }

    // 更远的长辈
    return (paternal ? '' : '外') + `${genDiff}代${targetGender === 'female' ? '女性长辈' : '男性长辈'}`
  }

  // --- 晚辈旁系：genDiff < 0 ---
  if (genDiff < 0) {
    const absDiff = -genDiff  // 晚几代

    // 同辈旁系亲属：侄/甥区分取决于同辈亲属的性别（男→侄，女→甥）
    // 同辈旁系在 path 中的索引 = 2*up - 1（up个parent回到共同祖先，再up-1个child回到同辈）
    const sameGenIdx = 2 * up - 1
    const throughMale = sameGenIdx < path.length ? path[sameGenIdx].toGender === 'male' : true

    if (absDiff === 1) {
      // 侄甥辈
      if (up === 1 && down === 2) {
        if (throughMale) {
          return targetGender === 'female' ? '侄女' : '侄子'
        }
        return targetGender === 'female' ? '外甥女' : '外甥'
      }
      // 其他 absDiff=1 的组合（如 up=2,down=3）
      return collateralNephewLabel(sameGenerationTang, throughMale, targetGender)
    }

    if (absDiff === 2) {
      if (up === 1 && down === 3) {
        if (throughMale) {
          return targetGender === 'female' ? '侄孙女' : '侄孙'
        }
        return targetGender === 'female' ? '外甥孙女' : '外甥孙'
      }
      return collateralGrandNephewLabel(sameGenerationTang, throughMale, targetGender)
    }

    return throughMale
      ? `${absDiff + 1}代侄辈`
      : `${absDiff + 1}代甥辈`
  }

  return `${up}代上${down}代下旁系`
}

function collateralPrefixIsTang(up: number, paternal: boolean, branchIsMale: boolean): boolean {
  if (up === 2) {
    return paternal && branchIsMale
  }
  return branchIsMale
}

function grandCollateralLabel(
  path: PathStep[],
  paternal: boolean,
  targetGender: TargetGender,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): string {
  const grandparentGender = path[1]?.toGender
  const grandparentId = path[1]?.toId

  if (paternal) {
    if (grandparentGender === 'female') {
      return targetGender === 'female' ? '姨奶奶' : '舅爷爷'
    }
    if (targetGender === 'female') return '姑奶奶'
    const ageOrder = grandparentId
      ? compareAgeById(targetId(path), grandparentId, members, siblingOrders)
      : 'unknown'
    if (ageOrder === 'older') return '伯公'
    if (ageOrder === 'younger') return '叔公'
    return '伯叔公'
  }

  if (grandparentGender === 'female') {
    return targetGender === 'female' ? '姨外婆' : '舅外公'
  }
  if (targetGender === 'female') return '姑外婆'
  const ageOrder = grandparentId
    ? compareAgeById(targetId(path), grandparentId, members, siblingOrders)
    : 'unknown'
  if (ageOrder === 'older') return '伯外公'
  if (ageOrder === 'younger') return '叔外公'
  return '伯叔外公'
}

/** 从 path 获取最终目标 ID */
function targetId(path: PathStep[]): string {
  return path[path.length - 1].toId
}

/**
 * 父母辈旁系称谓（genDiff=1，但不是直接的叔伯姑舅姨）。
 * 例如：父亲的表兄弟 → 表叔/表伯，母亲的表姐妹 → 表姨
 *
 * paternal: 第一步走男（父系）还是女（母系）
 * branchIsMale: 分叉点是男（堂系）还是女（表系）
 */
function collateralUncleLabel(
  paternal: boolean,
  branchIsMale: boolean,
  targetGender: TargetGender,
  path: PathStep[],
  selfId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): string {
  // 分叉点是男性 → 堂系（同姓旁系）；分叉点是女性 → 表系（异姓旁系）
  const prefix = branchIsMale ? '堂' : '表'

  if (paternal) {
    // 父系
    if (targetGender === 'female') {
      return `${prefix}姑`
    }
    // 男：区分伯/叔（比较目标和父亲的年龄）
    const parentId = path[0].toId // 第一步 parent = 父亲
    const uncleId = targetId(path)
    const ageOrder = compareAgeById(uncleId, parentId, members, siblingOrders)
    if (ageOrder === 'older') return `${prefix}伯`
    if (ageOrder === 'younger') return `${prefix}叔`
    return `${prefix}叔伯`
  }

  // 母系
  if (targetGender === 'female') {
    return `${prefix}姨`
  }
  return `${prefix}舅`
}

/**
 * 晚辈旁系称谓（堂/表侄甥等）。
 */
function collateralNephewLabel(
  branchIsMale: boolean,
  throughMale: boolean,
  targetGender: TargetGender,
): string {
  const prefix = branchIsMale ? '堂' : '表'
  if (throughMale) {
    return targetGender === 'female' ? `${prefix}侄女` : `${prefix}侄`
  }
  return targetGender === 'female' ? `${prefix}外甥女` : `${prefix}外甥`
}

function collateralGrandNephewLabel(
  branchIsMale: boolean,
  throughMale: boolean,
  targetGender: TargetGender,
): string {
  const prefix = branchIsMale ? '堂' : '表'
  if (throughMale) {
    return targetGender === 'female' ? `${prefix}侄孙女` : `${prefix}侄孙`
  }
  return targetGender === 'female' ? `${prefix}外甥孙女` : `${prefix}外甥孙`
}

/**
 * 兄弟姐妹称谓（区分长幼 + 半亲）。
 */
function siblingLabel(
  targetGender: TargetGender,
  selfVsTarget: AgeOrder,
  relType?: RelType,
): string {
  if (relType === 'half') {
    if (selfVsTarget === 'unknown') {
      return targetGender === 'female' ? '半亲姐妹' : '半亲兄弟'
    }
    return selfVsTarget === 'older'
      ? (targetGender === 'female' ? '半亲姐姐' : '半亲哥哥')
      : (targetGender === 'female' ? '半亲妹妹' : '半亲弟弟')
  }
  if (selfVsTarget === 'unknown') {
    return targetGender === 'female' ? '姐妹' : '兄弟'
  }
  return selfVsTarget === 'older'
    ? (targetGender === 'female' ? '姐姐' : '哥哥')
    : (targetGender === 'female' ? '妹妹' : '弟弟')
}

/**
 * 父系叔伯称谓：区分伯父（比父亲年长）/ 叔叔（比父亲年幼）。
 * 路径形如 [parent(dad), parent(gpa), child(uncle)]，up=2, down=1
 */
function unclePaternalLabel(
  path: PathStep[],
  selfId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): string {
  const parentId = path[0].toId
  const uncleId = targetId(path)
  const ageOrder = compareAgeById(uncleId, parentId, members, siblingOrders)
  if (ageOrder === 'older') return '伯父'
  if (ageOrder === 'younger') return '叔叔'
  return '叔伯'
}

// ==================== 姻亲：末尾 spouse（某亲属的配偶）====================

function inLawByInner(
  innerLabel: string,
  targetGender: TargetGender,
  spouseType: RelType | undefined,
): string {
  // 兄弟姐妹的配偶
  if (innerLabel === '哥哥') return targetGender === 'female' ? '嫂子' : '哥哥'
  if (innerLabel === '弟弟') return targetGender === 'female' ? '弟媳' : '弟弟'
  if (innerLabel === '姐姐') return targetGender === 'female' ? '姐姐' : '姐夫'
  if (innerLabel === '妹妹') return targetGender === 'female' ? '妹妹' : '妹夫'
  if (innerLabel === '兄弟') return targetGender === 'female' ? '嫂子/弟媳' : '兄弟'
  if (innerLabel === '姐妹') return targetGender === 'female' ? '姐妹' : '姐夫/妹夫'
  // 子女的配偶
  if (innerLabel === '儿子') return targetGender === 'female' ? '儿媳' : '儿子'
  if (innerLabel === '女儿') return targetGender === 'female' ? '女儿' : '女婿'
  if (innerLabel === '养子') return targetGender === 'female' ? '养儿媳' : '养子'
  if (innerLabel === '养女') return targetGender === 'female' ? '养女' : '养女婿'
  if (innerLabel === '继子') return targetGender === 'female' ? '继儿媳' : '继子'
  if (innerLabel === '继女') return targetGender === 'female' ? '继女' : '继女婿'
  // 孙辈的配偶
  if (innerLabel === '孙子') return targetGender === 'female' ? '孙媳' : '孙子'
  if (innerLabel === '孙女') return targetGender === 'female' ? '孙女' : '孙女婿'
  if (innerLabel === '外孙') return targetGender === 'female' ? '外孙媳' : '外孙'
  if (innerLabel === '外孙女') return targetGender === 'female' ? '外孙女' : '外孙女婿'
  if (innerLabel === '曾孙') return targetGender === 'female' ? '曾孙妇' : '曾孙'
  if (innerLabel === '曾孙女') return targetGender === 'female' ? '曾孙女' : '曾孙女婿'
  if (innerLabel === '外曾孙') return targetGender === 'female' ? '外曾孙媳妇' : '外曾孙'
  if (innerLabel === '外曾孙女') return targetGender === 'female' ? '外曾孙女' : '外曾孙女婿'
  if (innerLabel === '玄孙') return targetGender === 'female' ? '玄孙媳妇' : '玄孙'
  if (innerLabel === '玄孙女') return targetGender === 'female' ? '玄孙女' : '玄孙女婿'
  if (innerLabel === '外玄孙') return targetGender === 'female' ? '外玄孙媳妇' : '外玄孙'
  if (innerLabel === '外玄孙女') return targetGender === 'female' ? '外玄孙女' : '外玄孙女婿'
  // 侄辈的配偶
  if (innerLabel === '侄子') return targetGender === 'female' ? '侄媳' : '侄子'
  if (innerLabel === '侄女') return targetGender === 'female' ? '侄女' : '侄女婿'
  if (innerLabel === '外甥') return targetGender === 'female' ? '甥媳' : '外甥'
  if (innerLabel === '外甥女') return targetGender === 'female' ? '外甥女' : '甥女婿'
  if (innerLabel === '侄孙') return targetGender === 'female' ? '侄孙妇' : '侄孙'
  if (innerLabel === '侄孙女') return targetGender === 'female' ? '侄孙女' : '侄孙婿'
  if (innerLabel === '外甥孙') return targetGender === 'female' ? '甥孙妇' : '外甥孙'
  if (innerLabel === '外甥孙女') return targetGender === 'female' ? '外甥孙女' : '甥孙婿'
  // 叔伯配偶
  if (innerLabel === '伯父') return targetGender === 'female' ? '伯母' : '伯父'
  if (innerLabel === '叔叔') return targetGender === 'female' ? '婶婶' : '叔叔'
  if (innerLabel === '叔伯') return targetGender === 'female' ? '婶婶/伯母' : '叔伯'
  if (innerLabel === '姑姑') return targetGender === 'female' ? '姑姑' : '姑父'
  if (innerLabel === '舅舅') return targetGender === 'female' ? '舅妈' : '舅舅'
  if (innerLabel === '姨') return targetGender === 'female' ? '姨' : '姨父'
  // 祖辈旁系亲属的配偶
  if (innerLabel === '伯公') return targetGender === 'female' ? '伯婆' : '伯公'
  if (innerLabel === '叔公') return targetGender === 'female' ? '叔婆' : '叔公'
  if (innerLabel === '伯叔公') return targetGender === 'female' ? '伯叔婆' : '伯叔公'
  if (innerLabel === '姑奶奶') return targetGender === 'female' ? '姑奶奶' : '姑爷爷'
  if (innerLabel === '舅爷爷') return targetGender === 'female' ? '舅奶奶' : '舅爷爷'
  if (innerLabel === '姨奶奶') return targetGender === 'female' ? '姨奶奶' : '姨爷爷'
  if (innerLabel === '伯外公') return targetGender === 'female' ? '伯外婆' : '伯外公'
  if (innerLabel === '叔外公') return targetGender === 'female' ? '叔外婆' : '叔外公'
  if (innerLabel === '伯叔外公') return targetGender === 'female' ? '伯叔外婆' : '伯叔外公'
  if (innerLabel === '姑外婆') return targetGender === 'female' ? '姑外婆' : '姑外公'
  if (innerLabel === '舅外公') return targetGender === 'female' ? '舅外婆' : '舅外公'
  if (innerLabel === '姨外婆') return targetGender === 'female' ? '姨外婆' : '姨外公'
  // 堂/表祖辈旁系亲属的配偶
  if (innerLabel === '堂叔公') return targetGender === 'female' ? '堂叔婆' : '堂叔公'
  if (innerLabel === '堂姑奶奶') return targetGender === 'female' ? '堂姑奶奶' : '堂姑爷爷'
  if (innerLabel === '堂舅姥爷') return targetGender === 'female' ? '堂舅姥姥' : '堂舅姥爷'
  if (innerLabel === '堂姨姥') return targetGender === 'female' ? '堂姨姥' : '堂姨姥爷'
  if (innerLabel === '表叔公') return targetGender === 'female' ? '表叔婆' : '表叔公'
  if (innerLabel === '表姑奶奶') return targetGender === 'female' ? '表姑奶奶' : '表姑爷爷'
  if (innerLabel === '表舅姥爷') return targetGender === 'female' ? '表舅姥姥' : '表舅姥爷'
  if (innerLabel === '表姨姥') return targetGender === 'female' ? '表姨姥' : '表姨姥爷'
  // 堂/表叔伯姑舅姨的配偶
  if (innerLabel === '表伯') return targetGender === 'female' ? '表伯母' : '表伯'
  if (innerLabel === '表叔') return targetGender === 'female' ? '表婶' : '表叔'
  if (innerLabel === '表叔伯') return targetGender === 'female' ? '表婶/表伯母' : '表叔伯'
  if (innerLabel === '表姑') return targetGender === 'female' ? '表姑' : '表姑父'
  if (innerLabel === '表舅') return targetGender === 'female' ? '表舅妈' : '表舅'
  if (innerLabel === '表姨') return targetGender === 'female' ? '表姨' : '表姨父'
  if (innerLabel === '堂叔') return targetGender === 'female' ? '堂婶' : '堂叔'
  if (innerLabel === '堂伯') return targetGender === 'female' ? '堂伯母' : '堂伯'
  if (innerLabel === '堂姑') return targetGender === 'female' ? '堂姑' : '堂姑丈'
  if (innerLabel === '堂舅') return targetGender === 'female' ? '堂舅妈' : '堂舅'
  if (innerLabel === '堂姨') return targetGender === 'female' ? '堂姨' : '堂姨丈'
  // 堂/表兄弟姐妹的配偶
  if (innerLabel === '堂兄弟') return targetGender === 'female' ? '堂嫂' : '堂兄弟'
  if (innerLabel === '堂兄') return targetGender === 'female' ? '堂嫂' : '堂兄'
  if (innerLabel === '堂弟') return targetGender === 'female' ? '堂弟媳' : '堂弟'
  if (innerLabel === '堂姐妹') return targetGender === 'female' ? '堂姐妹' : '堂姐夫/妹夫'
  if (innerLabel === '堂姐') return targetGender === 'female' ? '堂姐' : '堂姐夫'
  if (innerLabel === '堂妹') return targetGender === 'female' ? '堂妹' : '堂妹夫'
  if (innerLabel === '表兄弟') return targetGender === 'female' ? '表嫂' : '表兄弟'
  if (innerLabel === '表兄') return targetGender === 'female' ? '表嫂' : '表兄'
  if (innerLabel === '表弟') return targetGender === 'female' ? '表弟媳' : '表弟'
  if (innerLabel === '表姐妹') return targetGender === 'female' ? '表姐妹' : '表姐夫/妹夫'
  if (innerLabel === '表姐') return targetGender === 'female' ? '表姐' : '表姐夫'
  if (innerLabel === '表妹') return targetGender === 'female' ? '表妹' : '表妹夫'
  if (innerLabel === '远房堂兄弟') return targetGender === 'female' ? '远房堂嫂/弟媳' : '远房堂兄弟'
  if (innerLabel === '远房堂姐妹') return targetGender === 'female' ? '远房堂姐妹' : '远房堂姐夫/妹夫'
  if (innerLabel === '远房表兄弟') return targetGender === 'female' ? '远房表嫂/弟媳' : '远房表兄弟'
  if (innerLabel === '远房表姐妹') return targetGender === 'female' ? '远房表姐妹' : '远房表姐夫/妹夫'
  // 堂/表侄辈的配偶
  if (innerLabel === '堂侄') return targetGender === 'female' ? '堂侄媳' : '堂侄'
  if (innerLabel === '堂侄女') return targetGender === 'female' ? '堂侄女' : '堂侄女婿'
  if (innerLabel === '表侄') return targetGender === 'female' ? '表侄媳' : '表侄'
  if (innerLabel === '表侄女') return targetGender === 'female' ? '表侄女' : '表侄女婿'
  if (innerLabel === '表外甥') return targetGender === 'female' ? '表甥媳' : '表外甥'
  if (innerLabel === '表外甥女') return targetGender === 'female' ? '表外甥女' : '表甥女婿'
  if (innerLabel === '表侄孙') return targetGender === 'female' ? '表侄孙妇' : '表侄孙'
  if (innerLabel === '表侄孙女') return targetGender === 'female' ? '表侄孙女' : '表侄孙婿'
  if (innerLabel === '表外甥孙') return targetGender === 'female' ? '表甥孙妇' : '表外甥孙'
  if (innerLabel === '表外甥孙女') return targetGender === 'female' ? '表外甥孙女' : '表甥孙婿'
  if (innerLabel === '堂外甥') return targetGender === 'female' ? '堂甥媳' : '堂外甥'
  if (innerLabel === '堂外甥女') return targetGender === 'female' ? '堂外甥女' : '堂甥女婿'
  // 父母的配偶：家谱可能尚未补全另一方亲子边，不能仅凭缺边推断为继配。
  if (innerLabel === '父亲') {
    if (spouseType === 'divorced') {
      if (targetGender === 'female') return '父亲的前妻'
      if (targetGender === 'male') return '父亲的前夫'
      return '父亲的前伴侣'
    }
    if (targetGender === 'female') return '父亲的妻子'
    if (targetGender === 'male') return '父亲的丈夫'
    return '父亲的伴侣'
  }
  if (innerLabel === '母亲') {
    if (spouseType === 'divorced') {
      if (targetGender === 'male') return '母亲的前夫'
      if (targetGender === 'female') return '母亲的前妻'
      return '母亲的前伴侣'
    }
    if (targetGender === 'male') return '母亲的丈夫'
    if (targetGender === 'female') return '母亲的妻子'
    return '母亲的伴侣'
  }
  if (innerLabel === '继父') return targetGender === 'female' ? '继母' : '继父'
  if (innerLabel === '继母') return targetGender === 'female' ? '继母' : '继父'
  const ancestorSpouse = ancestorSpouseLabel(innerLabel, targetGender, spouseType)
  if (ancestorSpouse) return ancestorSpouse
  return '远房亲戚'
}

function ancestorSpouseLabel(
  innerLabel: string,
  targetGender: TargetGender,
  spouseType: RelType | undefined,
): string | null {
  const formalNames: Record<string, { male: string; female: string }> = {
    爷爷: { male: '祖父', female: '祖母' },
    奶奶: { male: '祖父', female: '祖母' },
    外公: { male: '外祖父', female: '外祖母' },
    外婆: { male: '外祖父', female: '外祖母' },
    曾祖父: { male: '曾祖父', female: '曾祖母' },
    曾祖母: { male: '曾祖父', female: '曾祖母' },
    外曾祖父: { male: '外曾祖父', female: '外曾祖母' },
    外曾祖母: { male: '外曾祖父', female: '外曾祖母' },
    高祖父: { male: '高祖父', female: '高祖母' },
    高祖母: { male: '高祖父', female: '高祖母' },
    外高祖父: { male: '外高祖父', female: '外高祖母' },
    外高祖母: { male: '外高祖父', female: '外高祖母' },
  }
  const names = formalNames[innerLabel]
  if (!names) return null

  const innerGender = innerLabel.endsWith('父') || innerLabel === '爷爷' || innerLabel === '外公'
    ? 'male'
    : 'female'
  if (spouseType === 'divorced') {
    if (targetGender === 'female') return `${names[innerGender]}的前妻`
    if (targetGender === 'male') return `${names[innerGender]}的前夫`
    return `${names[innerGender]}的前伴侣`
  }
  if (targetGender === 'female') return `${names[innerGender]}的妻子`
  if (targetGender === 'male') return `${names[innerGender]}的丈夫`
  return `${names[innerGender]}的伴侣`
}

// ==================== 姻亲：开头 spouse（配偶的亲属）====================

function viaSpouseLabel(
  innerLabel: string,
  targetGender: TargetGender,
  selfGender: TargetGender,
): string {
  if (innerLabel === '父亲') return selfGender === 'female' ? '公公' : '岳父'
  if (innerLabel === '母亲') return selfGender === 'female' ? '婆婆' : '岳母'
  if (innerLabel === '儿子') return '继子'
  if (innerLabel === '女儿') return '继女'
  if (innerLabel === '养子') return '继子'
  if (innerLabel === '养女') return '继女'
  if (innerLabel === '继子') return '继子'
  if (innerLabel === '继女') return '继女'
  if (innerLabel === '哥哥' || innerLabel === '弟弟' || innerLabel === '兄弟' ||
      innerLabel === '堂兄' || innerLabel === '堂弟' || innerLabel === '堂兄弟') {
    return selfGender === 'female' ? '大伯子/小叔子' : '大舅子/小舅子'
  }
  if (innerLabel === '姐姐' || innerLabel === '妹妹' || innerLabel === '姐妹' ||
      innerLabel === '堂姐' || innerLabel === '堂妹' || innerLabel === '堂姐妹') {
    return selfGender === 'female' ? '大姑子/小姑子' : '大姨子/小姨子'
  }
  return '远房亲戚'
}

// ==================== 多 spouse 路径：妯娌/连襟等 ====================

function multiSpouseLabel(path: PathStep[]): string {
  const kinds = path.map((s) => s.kind)

  if (kinds[0] === 'spouse' && kinds[kinds.length - 1] === 'spouse') {
    const innerPath = path.slice(1, -1)
    if (innerPath.length === 0) return '远房亲戚'
    const innerKinds = innerPath.map((s) => s.kind)

    const noSpouseInner = !innerKinds.includes('spouse')
    const firstChildIdx = innerKinds.indexOf('child')
    const lastParentIdx = innerKinds.lastIndexOf('parent')

    if (noSpouseInner && firstChildIdx > 0 && lastParentIdx < firstChildIdx &&
        innerKinds.slice(0, firstChildIdx).every((k) => k === 'parent') &&
        innerKinds.slice(firstChildIdx).every((k) => k === 'child')) {
      const up = firstChildIdx
      const down = innerKinds.length - firstChildIdx

      if (up === 1 && down === 1) {
        const innerTargetGender = innerPath[innerPath.length - 1].toGender
        if (innerTargetGender === 'male') {
          return '妯娌'
        } else {
          return '连襟'
        }
      }
    }

    return '远房亲戚'
  }

  return '远房亲戚'
}

// ==================== sibling 未展开兜底 ====================

function siblingFallbackLabel(
  path: PathStep[],
  targetGender: TargetGender,
  selfId: string,
  members: Record<string, Member>,
  siblingOrders: SiblingOrders,
): string {
  if (path.length === 1 && path[0].kind === 'sibling') {
    const selfVsTarget = compareAgeById(path[0].toId, selfId, members, siblingOrders)
    return siblingLabel(targetGender, selfVsTarget, path[0].relType)
  }
  return '远房亲戚'
}
