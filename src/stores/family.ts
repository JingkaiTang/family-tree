import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  reconcileLayoutPreferences,
  withRowOrderPreference,
} from '@/core/family-layout/reconcilePreferences'
import type { ChildLayoutAssignment, FamilyData, GridLayoutOverride, Member, ProjectMeta } from '@/core/schema'
import { createEmptyFamily } from '@/core/schema'
import { setLastProjectPath } from '@/services/prefs'

/**
 * family store 的职责：
 * - 持有当前家族数据（members + nicknameOverrides + rootMemberId）
 * - 提供受控的增删改 API
 * - 暴露 isDirty 供 autosave 订阅
 *
 * 持久化由 services/autosave.ts 订阅本 store 的 mutation 后防抖写盘。
 */
export const useFamilyStore = defineStore('family', () => {
  const projectPath = ref<string | null>(null)
  const projectMeta = ref<ProjectMeta | null>(null)
  const data = ref<FamilyData>(createEmptyFamily())
  const isDirty = ref(false)
  /** 最近一次成功保存的时间戳，用于 UI 显示 */
  const lastSavedAt = ref<number | null>(null)

  const membersArray = computed(() => Object.values(data.value.members))
  const memberCount = computed(() => membersArray.value.length)

  function setProject(path: string, meta: ProjectMeta, family: FamilyData) {
    projectPath.value = path
    projectMeta.value = meta
    data.value = family
    isDirty.value = false
    lastSavedAt.value = Date.now()
    setLastProjectPath(path)
  }

  function closeProject() {
    projectPath.value = null
    projectMeta.value = null
    data.value = createEmptyFamily()
    isDirty.value = false
    lastSavedAt.value = null
    setLastProjectPath(null)
  }

  function markClean() {
    isDirty.value = false
    lastSavedAt.value = Date.now()
  }

  function markDirty() {
    isDirty.value = true
  }

  // ---------------- Member CRUD ----------------

  function getMember(id: string): Member | undefined {
    return data.value.members[id]
  }

  function upsertMember(member: Member) {
    data.value.members[member.id] = member
    markDirty()
  }

  function updateMember(id: string, patch: Partial<Member>) {
    const m = data.value.members[id]
    if (!m) return
    data.value.members[id] = { ...m, ...patch }
    markDirty()
  }

  function deleteMember(id: string) {
    const m = data.value.members[id]
    if (!m) return
    // 在其他成员的关系列表中移除对它的引用
    for (const other of Object.values(data.value.members)) {
      other.parents = other.parents.filter((r) => r.id !== id)
      other.children = other.children.filter((r) => r.id !== id)
      other.siblings = other.siblings.filter((r) => r.id !== id)
      other.spouses = other.spouses.filter((r) => r.id !== id)
      other.godparents = other.godparents.filter((r) => r.id !== id)
      other.godchildren = other.godchildren.filter((r) => r.id !== id)
    }
    // 清理称呼覆盖
    delete data.value.nicknameOverrides[id]
    for (const fromId of Object.keys(data.value.nicknameOverrides)) {
      delete data.value.nicknameOverrides[fromId][id]
    }
    if (data.value.rootMemberId === id) {
      data.value.rootMemberId = undefined
    }
    if (data.value.defaultViewpointId === id) {
      data.value.defaultViewpointId = undefined
    }
    // 清理手工拖动位置
    if (data.value.manualPositions[id]) {
      delete data.value.manualPositions[id]
    }
    delete data.value.members[id]
    data.value.layoutPreferences = reconcileLayoutPreferences(data.value)
    markDirty()
  }

  // ---------------- Relations (always bidirectional) ----------------

  type RelationKind = 'parent' | 'child' | 'sibling' | 'spouse' | 'godparent' | 'godchild'
  type LinkCurrentSpouseResult = { ok: true; conflicts: string[] } | { ok: false; conflicts: string[] }

  function currentSpouseId(member: Member): string | null {
    return member.spouses.find((spouse) => spouse.type === 'married')?.id ?? null
  }

  function getCurrentSpouseConflicts(memberId: string, otherId: string): string[] {
    const me = data.value.members[memberId]
    const other = data.value.members[otherId]
    if (!me || !other || memberId === otherId) return []

    return [...new Set([currentSpouseId(me), currentSpouseId(other)])]
      .filter((id): id is string => Boolean(id) && id !== memberId && id !== otherId)
      .sort((left, right) => left.localeCompare(right))
  }

  function removeCurrentSpouse(memberId: string) {
    const member = data.value.members[memberId]
    if (!member) return

    const spouseIds = member.spouses
      .filter((spouse) => spouse.type === 'married')
      .map((spouse) => spouse.id)
    member.spouses = member.spouses.filter((spouse) => spouse.type !== 'married')

    for (const spouseId of spouseIds) {
      const spouse = data.value.members[spouseId]
      if (!spouse) continue
      spouse.spouses = spouse.spouses.filter((ref) => !(ref.id === memberId && ref.type === 'married'))
    }
  }

  function linkCurrentSpouse(
    memberId: string,
    otherId: string,
    opts: { replaceConflicts?: boolean } = {},
  ): LinkCurrentSpouseResult {
    if (memberId === otherId) return { ok: false, conflicts: [] }
    const me = data.value.members[memberId]
    const other = data.value.members[otherId]
    if (!me || !other) return { ok: false, conflicts: [] }

    const conflicts = getCurrentSpouseConflicts(memberId, otherId)
    if (conflicts.length > 0 && !opts.replaceConflicts) {
      return { ok: false, conflicts }
    }

    removeCurrentSpouse(memberId)
    removeCurrentSpouse(otherId)
    me.spouses = me.spouses.filter((spouse) => spouse.id !== otherId)
    other.spouses = other.spouses.filter((spouse) => spouse.id !== memberId)
    me.spouses.push({ id: otherId, type: 'married' })
    other.spouses.push({ id: memberId, type: 'married' })
    me.spouses.sort((left, right) => left.id.localeCompare(right.id))
    other.spouses.sort((left, right) => left.id.localeCompare(right.id))
    markDirty()
    return { ok: true, conflicts }
  }

  /**
   * 在 memberId 和 otherId 之间建立一条关系。
   * 语义：`kind` 描述 other 相对于 memberId 的身份。
   *   - parent  : other 是 memberId 的父/母  → memberId.parents += other, other.children += memberId
   *   - child   : other 是 memberId 的子女  → memberId.children += other, other.parents += memberId
   *   - sibling : other 是 memberId 的兄弟姐妹（对称）
   *   - spouse  : other 是 memberId 的配偶（对称）
   *   - godparent: other 是 memberId 的干爹/干妈  → memberId.godparents += other, other.godchildren += memberId
   *   - godchild : other 是 memberId 的干儿子/干女儿 → memberId.godchildren += other, other.godparents += memberId
   * 自动维护双向一致。
   */
  function linkRelation(memberId: string, otherId: string, kind: RelationKind) {
    if (memberId === otherId) return
    const me = data.value.members[memberId]
    const other = data.value.members[otherId]
    if (!me || !other) return

    const ensure = <T extends { id: string; type: string }>(arr: T[], ref: T) => {
      if (!arr.some((r) => r.id === ref.id)) arr.push(ref)
    }

    if (kind === 'parent') {
      // other 是 me 的父母
      ensure(me.parents, { id: otherId, type: 'blood' })
      ensure(other.children, { id: memberId, type: 'blood' })
    } else if (kind === 'child') {
      // other 是 me 的子女
      ensure(me.children, { id: otherId, type: 'blood' })
      ensure(other.parents, { id: memberId, type: 'blood' })
    } else if (kind === 'sibling') {
      ensure(me.siblings, { id: otherId, type: 'blood' })
      ensure(other.siblings, { id: memberId, type: 'blood' })
    } else if (kind === 'spouse') {
      linkCurrentSpouse(memberId, otherId)
      return
    } else if (kind === 'godparent') {
      // other 是 me 的干爹/干妈
      ensure(me.godparents, { id: otherId, type: 'godparent' })
      ensure(other.godchildren, { id: memberId, type: 'godchild' })
    } else if (kind === 'godchild') {
      // other 是 me 的干儿子/干女儿
      ensure(me.godchildren, { id: otherId, type: 'godchild' })
      ensure(other.godparents, { id: memberId, type: 'godparent' })
    }
    markDirty()
  }

  function unlinkRelation(memberId: string, otherId: string, kind: RelationKind) {
    const me = data.value.members[memberId]
    const other = data.value.members[otherId]
    if (!me || !other) return

    if (kind === 'parent') {
      me.parents = me.parents.filter((r) => r.id !== otherId)
      other.children = other.children.filter((r) => r.id !== memberId)
    } else if (kind === 'child') {
      me.children = me.children.filter((r) => r.id !== otherId)
      other.parents = other.parents.filter((r) => r.id !== memberId)
    } else if (kind === 'sibling') {
      me.siblings = me.siblings.filter((r) => r.id !== otherId)
      other.siblings = other.siblings.filter((r) => r.id !== memberId)
    } else if (kind === 'spouse') {
      me.spouses = me.spouses.filter((r) => r.id !== otherId)
      other.spouses = other.spouses.filter((r) => r.id !== memberId)
    } else if (kind === 'godparent') {
      me.godparents = me.godparents.filter((r) => r.id !== otherId)
      other.godchildren = other.godchildren.filter((r) => r.id !== memberId)
    } else if (kind === 'godchild') {
      me.godchildren = me.godchildren.filter((r) => r.id !== otherId)
      other.godparents = other.godparents.filter((r) => r.id !== memberId)
    }
    markDirty()
  }

  function setNicknameOverride(fromId: string, toId: string, label: string | null) {
    if (!data.value.nicknameOverrides[fromId]) {
      data.value.nicknameOverrides[fromId] = {}
    }
    if (label === null || label === '') {
      delete data.value.nicknameOverrides[fromId][toId]
      if (Object.keys(data.value.nicknameOverrides[fromId]).length === 0) {
        delete data.value.nicknameOverrides[fromId]
      }
    } else {
      data.value.nicknameOverrides[fromId][toId] = label
    }
    markDirty()
  }

  function setRootMember(id: string | undefined) {
    data.value.rootMemberId = id
    markDirty()
  }

  /** 保存上次选用的视角成员到项目文件。下次打开自动恢复。传 undefined 清空。 */
  function setDefaultViewpoint(id: string | undefined) {
    if (data.value.defaultViewpointId === id) return
    data.value.defaultViewpointId = id
    markDirty()
  }

  function setChildLayoutAssignment(id: string, assignment: ChildLayoutAssignment | null) {
    if (!data.value.members[id]) return
    data.value.childLayoutAssignments ??= {}

    if (!assignment || (!assignment.primaryParentId && !assignment.primarySpouseId)) {
      delete data.value.childLayoutAssignments[id]
    } else {
      data.value.childLayoutAssignments[id] = assignment
    }
    markDirty()
  }

  function setGridLayoutOverride(slotId: string, override: GridLayoutOverride | null) {
    data.value.gridLayoutOverrides ??= {}

    if (!override) {
      delete data.value.gridLayoutOverrides[slotId]
    } else {
      data.value.gridLayoutOverrides[slotId] = override
    }
    markDirty()
  }

  function setRowOrderPreference(id: string, unitIds: string[]) {
    data.value = withRowOrderPreference(data.value, id, unitIds)
    markDirty()
  }

  function setFamilyAccentAssignment(unitId: string, accent: string | null) {
    if (accent === null) delete data.value.layoutPreferences.familyAccentAssignments[unitId]
    else data.value.layoutPreferences.familyAccentAssignments[unitId] = accent
    markDirty()
  }

  /**
   * 把某成员的手工拖动位置写入 data.manualPositions。
   * 调用者需传入 cell 单位（与 treeLayout 的 LaidOutNode.cx/top 同），
   * 且是"平移前"的原始坐标（参见 layoutFamilyTree 的 offsetX 字段）。
   */
  function setManualPosition(id: string, cx: number, top: number) {
    if (!data.value.members[id]) return
    data.value.manualPositions[id] = { cx, top }
    markDirty()
  }

  /** 撤销某成员的手工位置，回到算法布局 */
  function clearManualPosition(id: string) {
    if (data.value.manualPositions[id]) {
      delete data.value.manualPositions[id]
      markDirty()
    }
  }

  // 深度监听 data，一旦任何字段改变就标记 dirty（保底兜底，正常变更都走上面方法）
  watch(
    data,
    () => {
      // 仅当项目已打开时才触发 dirty（避免 setProject 时误标）
      if (projectPath.value !== null) {
        isDirty.value = true
      }
    },
    { deep: true },
  )

  return {
    // state
    projectPath,
    projectMeta,
    data,
    isDirty,
    lastSavedAt,
    // getters
    membersArray,
    memberCount,
    // actions
    setProject,
    closeProject,
    markClean,
    markDirty,
    getMember,
    upsertMember,
    updateMember,
    deleteMember,
    getCurrentSpouseConflicts,
    linkCurrentSpouse,
    linkRelation,
    unlinkRelation,
    setNicknameOverride,
    setRootMember,
    setDefaultViewpoint,
    setChildLayoutAssignment,
    setGridLayoutOverride,
    setRowOrderPreference,
    setFamilyAccentAssignment,
    setManualPosition,
    clearManualPosition,
  }
})
