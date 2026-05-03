import type { Member } from '@/core/schema'
import type { PathStep } from './pathFinder'

type TargetGender = 'male' | 'female' | 'other'

/**
 * 把规范化后的路径（只含 parent/child/spouse，sibling 已展开）
 * 翻译成中文称呼。覆盖高频关系，其余回退为"亲戚"。
 *
 * 路径表示：以 self 为起点，每一步走一条边。
 * 例如 [parent(a), parent(b)] 意思是"爷爷 a 的妻子 b"——但实际上我们的 parent 边
 * 已经是"走向某个父母"的方向，所以 [parent, parent] = 祖父/外祖父/祖母/外祖母之一。
 *
 * 本实现的策略：
 * 1. 按边类型归纳为几种模式：
 *    - 全是 parent → 直系祖先
 *    - 全是 child → 直系后代
 *    - 末尾 spouse → 姻亲
 *    - parent+ 然后 child+ → 旁系（叔伯姑舅姨 / 堂表兄弟姐妹）
 *    - 其他 → 回退
 * 2. 父系/母系判定：看第一步 parent 走向的是"父亲"还是"母亲"（由那一步的 toGender 决定）
 */

export function describeRelation(
  path: PathStep[],
  selfId: string,
  targetId: string,
  members: Record<string, Member>,
): string {
  if (path.length === 0) return '自己'
  if (selfId === targetId) return '自己'

  // 分解路径
  const kinds = path.map((s) => s.kind)
  const target = members[targetId]
  const targetGender: TargetGender = target?.gender ?? 'other'

  // --- 配偶 ---
  if (kinds.length === 1 && kinds[0] === 'spouse') {
    return targetGender === 'female' ? '妻子' : '丈夫'
  }

  // --- 直系祖先：parent × N ---
  if (kinds.every((k) => k === 'parent')) {
    return ancestorLabel(path, targetGender)
  }

  // --- 直系后代：child × N ---
  if (kinds.every((k) => k === 'child')) {
    return descendantLabel(path, targetGender)
  }

  // --- 父母 (1 parent) ---
  if (path.length === 1 && path[0].kind === 'parent') {
    return path[0].toGender === 'female' ? '母亲' : '父亲'
  }

  // --- 子女 (1 child) ---
  if (path.length === 1 && path[0].kind === 'child') {
    return targetGender === 'female' ? '女儿' : '儿子'
  }

  // --- 旁系：先若干 parent，然后若干 child（中间不能有 spouse）---
  //     e.g. [parent, child] = 兄弟姐妹；[parent, parent, child] = 叔/姑/舅/姨
  //          [parent, parent, child, child] = 堂/表 兄弟姐妹
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
    const up = firstChildIdx // 向上几代
    const down = kinds.length - firstChildIdx // 向下几代
    // 父系 or 母系：看 path[0]（第一步走向的 parent）的 gender
    const paternal = path[0].toGender === 'male'
    return collateralLabel(up, down, paternal, targetGender, path)
  }

  // --- 末尾是 spouse 的姻亲：走到某个亲属，再加一个配偶 ---
  if (kinds[kinds.length - 1] === 'spouse' && !kinds.slice(0, -1).includes('spouse')) {
    // 先算"去掉最后一步"到达的那个亲属的称呼，再加姻亲后缀
    const innerPath = path.slice(0, -1)
    const innerTargetId = innerPath[innerPath.length - 1].toId
    const innerLabel = describeRelation(innerPath, selfId, innerTargetId, members)
    return inLawByInner(innerLabel, targetGender)
  }

  // --- 末尾是 spouse 走到亲属：在中间出现 spouse，复杂姻亲 ---
  // 暂时只处理最常见：父亲的配偶 = 母亲（已在前面处理）、配偶的父母 = 岳父/公公 等
  if (kinds.length === 2 && kinds[0] === 'spouse') {
    const second = path[1]
    if (second.kind === 'parent') {
      // 配偶的父母
      const selfMember = members[selfId]
      if (selfMember?.gender === 'female') {
        return second.toGender === 'female' ? '婆婆' : '公公'
      }
      return second.toGender === 'female' ? '岳母' : '岳父'
    }
    if (second.kind === 'child') {
      // 配偶的子女 = 继子/继女（或亲生）
      return second.toGender === 'female' ? '女儿' : '儿子'
    }
  }

  // 回退
  return '亲戚'
}

// ---------- 辅助 ----------

function ancestorLabel(path: PathStep[], targetGender: TargetGender): string {
  const n = path.length
  // 第一步决定父系/母系
  const paternalFirst = path[0].toGender === 'male'
  if (n === 1) {
    return targetGender === 'female' ? '母亲' : '父亲'
  }
  if (n === 2) {
    if (paternalFirst) {
      return targetGender === 'female' ? '奶奶' : '爷爷'
    }
    return targetGender === 'female' ? '外婆' : '外公'
  }
  if (n === 3) {
    if (paternalFirst) {
      return targetGender === 'female' ? '曾祖母' : '曾祖父'
    }
    return targetGender === 'female' ? '外曾祖母' : '外曾祖父'
  }
  if (n === 4) {
    if (paternalFirst) {
      return targetGender === 'female' ? '高祖母' : '高祖父'
    }
    return targetGender === 'female' ? '外高祖母' : '外高祖父'
  }
  return `${n}代以上${paternalFirst ? '' : '外'}先人`
}

function descendantLabel(path: PathStep[], targetGender: TargetGender): string {
  const n = path.length
  if (n === 1) return targetGender === 'female' ? '女儿' : '儿子'
  if (n === 2) return targetGender === 'female' ? '孙女' : '孙子'
  if (n === 3) return targetGender === 'female' ? '曾孙女' : '曾孙'
  if (n === 4) return targetGender === 'female' ? '玄孙女' : '玄孙'
  return `${n}代以下晚辈`
}

/**
 * 旁系称呼：
 * up 向上几代（1 = 同辈，2 = 父辈，3 = 祖辈…）
 * down 向下几代（1 = 父母层 → 向下一层即父母的兄弟姐妹）
 * up===down 时是同辈旁系（兄弟姐妹 / 堂兄弟姐妹 / 表兄弟姐妹）
 * up>down 时是长辈旁系（叔姑舅姨等）
 * up<down 时是晚辈旁系（侄甥等）
 *
 * 为了让代码清晰：down 在我们的路径编码里是"从共同祖先向下到目标"的步数。
 */
function collateralLabel(
  up: number,
  down: number,
  paternal: boolean,
  targetGender: TargetGender,
  _path: PathStep[],
): string {
  // 同辈：up == down
  if (up === down && up === 1) {
    // 兄弟姐妹（共享父母，展开后路径 = [parent, child]）
    return targetGender === 'female' ? '姐妹' : '兄弟'
  }
  if (up === down && up === 2) {
    // 父母的兄弟姐妹的子女
    const prefix = paternal ? '堂' : '表'
    return targetGender === 'female' ? `${prefix}姐妹` : `${prefix}兄弟`
  }
  if (up === down && up >= 3) {
    return (paternal ? '远房堂' : '远房表') + (targetGender === 'female' ? '姐妹' : '兄弟')
  }

  // 长辈旁系：父母/祖父母/...的兄弟姐妹
  if (up > down && down === 1) {
    // 父母的兄弟姐妹（叔伯姑舅姨）：up=2
    if (up === 2) {
      // 父系：叔伯（男）/姑（女）；母系：舅（男）/姨（女）
      if (paternal) {
        return targetGender === 'female' ? '姑姑' : '叔伯'
      }
      return targetGender === 'female' ? '姨' : '舅舅'
    }
    // 祖父母的兄弟姐妹（up=3）：简化
    if (up === 3) {
      if (paternal) {
        return targetGender === 'female' ? '姑奶奶' : '叔公'
      }
      return targetGender === 'female' ? '姨姥' : '舅姥爷'
    }
    return (paternal ? '' : '外') + `${up - 1}代${targetGender === 'female' ? '女性长辈' : '男性长辈'}`
  }

  // 晚辈旁系：兄弟姐妹的子女等
  if (down > up && up === 1) {
    // 兄弟姐妹的子女（up=1, down>=2）
    if (down === 2) {
      // 侄 / 甥：看第一步 parent 走向——但 up=1 情况下，path[0] 是走向自己的父母
      // 实际上"兄弟的子女"走法是 [parent, child, child]，up=1 是无意义的；我们用
      // path[firstChildIdx-1] (即最后一个 parent) 其实就是 path[0]。
      // 目标性别 + 旁路的男女决定侄/甥。简化处理：
      return targetGender === 'female' ? '侄女' : '侄子'
    }
    // 更远的晚辈
    return `${down}代晚辈`
  }

  // 其他复杂情况
  return `${up}代上${down}代下旁系`
}

/**
 * 根据"内部称呼"再加上姻亲后缀。比如：
 * - 兄弟 + spouse → 嫂子 / 弟媳（性别区分）
 * - 姐妹 + spouse → 姐夫 / 妹夫
 * - 儿子 + spouse → 儿媳
 * - 女儿 + spouse → 女婿
 * - 其他：父/母 + spouse 已经被更高层处理为"母亲/父亲"或"继父/继母"
 */
function inLawByInner(innerLabel: string, targetGender: TargetGender): string {
  // 兄弟 → 嫂子（哥哥的妻子）/ 弟媳（弟弟的妻子） — 本实现简化：兄弟+女=嫂子/弟媳统称嫂（弟媳）
  // 注意我们没有长幼信息，无法区分"哥哥/弟弟"，这里用概念化标签。
  if (innerLabel === '兄弟') {
    return targetGender === 'female' ? '嫂子/弟媳' : '兄弟'
  }
  if (innerLabel === '姐妹') {
    return targetGender === 'female' ? '姐妹' : '姐夫/妹夫'
  }
  if (innerLabel === '儿子') return targetGender === 'female' ? '儿媳' : '儿子'
  if (innerLabel === '女儿') return targetGender === 'female' ? '女儿' : '女婿'
  if (innerLabel === '父亲') return targetGender === 'female' ? '母亲（或继母）' : '父亲'
  if (innerLabel === '母亲') return targetGender === 'female' ? '母亲' : '父亲（或继父）'
  // 通用姻亲
  return `${innerLabel}的配偶`
}
