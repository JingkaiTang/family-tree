import { z } from 'zod'

// 当前 schema 版本。每次 schema 有破坏性变更递增，并在 core/migrate.ts 添加迁移。
export const SCHEMA_VERSION = 5

// ---------------- Enums ----------------
export const Gender = z.enum(['male', 'female', 'other'])
export type Gender = z.infer<typeof Gender>

export const ParentType = z.enum(['blood', 'adopted', 'step'])
export const ChildType = z.enum(['blood', 'adopted', 'step'])
export const SiblingType = z.enum(['blood', 'half'])
export const SpouseType = z.enum(['married', 'divorced'])
/** 干亲关系 — 社会关系，不参与血缘/姻亲的称呼推算链。 */
export const GodparentType = z.enum(['godparent'])
export const GodchildType = z.enum(['godchild'])
export const PhotoId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)

// ---------------- Relations ----------------
const ParentRef = z.object({ id: z.string(), type: ParentType })
const ChildRef = z.object({ id: z.string(), type: ChildType })
const SiblingRef = z.object({ id: z.string(), type: SiblingType })
const SpouseRef = z.object({ id: z.string(), type: SpouseType })
const GodparentRef = z.object({ id: z.string(), type: GodparentType })
const GodchildRef = z.object({ id: z.string(), type: GodchildType })

// ---------------- Member ----------------
export const Member = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  nickname: z.string().optional(),
  gender: Gender,
  /** photoId 形如 "7f3a..."，实际文件在 media/photos/{photoId}.webp */
  photoId: PhotoId.optional(),
  birthDate: z.string().optional(), // ISO yyyy-mm-dd
  deathDate: z.string().optional(),
  birthPlace: z.string().optional(),
  occupation: z.string().optional(),
  education: z.string().optional(),
  currentResidence: z.string().optional(),
  notes: z.string().optional(),
  parents: z.array(ParentRef).default([]),
  children: z.array(ChildRef).default([]),
  siblings: z.array(SiblingRef).default([]),
  spouses: z.array(SpouseRef).default([]),
  /** 干爹 / 干妈（由目标性别决定具体称呼） */
  godparents: z.array(GodparentRef).default([]),
  /** 干儿子 / 干女儿 */
  godchildren: z.array(GodchildRef).default([]),
}).passthrough()
export type Member = z.infer<typeof Member>

/** Keep every JSON dictionary key without invoking Object.prototype's __proto__ setter. */
function stringRecord<Value extends z.ZodType>(valueSchema: Value) {
  const record = z.record(z.string(), valueSchema)
  return z.unknown().transform((input, ctx) => {
    const parsed = record.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue })
      return z.NEVER
    }
    // Zod deliberately skips this key. Validate its value too, then restore an own data property.
    if (typeof input === 'object' && input !== null
      && Object.prototype.propertyIsEnumerable.call(input, '__proto__')) {
      const special = valueSchema.safeParse(Reflect.get(input, '__proto__'))
      if (!special.success) {
        for (const issue of special.error.issues) {
          ctx.addIssue({ ...issue, path: ['__proto__', ...issue.path] })
        }
        return z.NEVER
      }
      Object.defineProperty(parsed.data, '__proto__', {
        value: special.data, enumerable: true, configurable: true, writable: true,
      })
    }
    return parsed.data
  })
}

// ---------------- FamilyData ----------------
export const NicknameOverrides = stringRecord(stringRecord(z.string()))
export type NicknameOverrides = z.infer<typeof NicknameOverrides>

/** 同一兄弟姐妹关系组共享的顺序。key 使用 parentage id 或规范化的 siblings id。 */
export const SiblingOrders = stringRecord(z.array(z.string()))
export type SiblingOrders = z.infer<typeof SiblingOrders>

/** @deprecated V2 手工坐标仅为兼容旧文件保留，新布局忽略。 */
export const ManualPosition = z.object({
  cx: z.number(),
  top: z.number(),
})
export type ManualPosition = z.infer<typeof ManualPosition>
export const ManualPositions = stringRecord(ManualPosition)
export type ManualPositions = z.infer<typeof ManualPositions>

export const ChildLayoutAssignment = z.object({
  primaryParentId: z.string().optional(),
  primarySpouseId: z.string().optional(),
})
export type ChildLayoutAssignment = z.infer<typeof ChildLayoutAssignment>
export const ChildLayoutAssignments = stringRecord(ChildLayoutAssignment)
export type ChildLayoutAssignments = z.infer<typeof ChildLayoutAssignments>

export const GridLayoutOverride = z.object({
  order: z.number(),
})
export type GridLayoutOverride = z.infer<typeof GridLayoutOverride>
export const GridLayoutOverrides = stringRecord(GridLayoutOverride)
export type GridLayoutOverrides = z.infer<typeof GridLayoutOverrides>

export const RowOrderPreference = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1),
  generation: z.number().int(),
  unitIds: z.array(z.string().min(1)),
  columns: stringRecord(z.number().int().nonnegative()).optional(),
})
export type RowOrderPreference = z.infer<typeof RowOrderPreference>
export const RootOrderPreference = z.object({
  componentId: z.string().min(1),
  rootIds: z.array(z.string().min(1)),
})
export type RootOrderPreference = z.infer<typeof RootOrderPreference>
export const BridgeOrderPreference = RowOrderPreference
export type BridgeOrderPreference = z.infer<typeof BridgeOrderPreference>
export interface LayoutRowPreferenceBatch {
  rowOrders: RowOrderPreference[]
  bridgeOrders: BridgeOrderPreference[]
}
export const PersistedLayoutPreferences = z.object({
  rootOrders: z.array(RootOrderPreference).default([]),
  rowOrders: z.array(RowOrderPreference).default([]),
  bridgeOrders: z.array(BridgeOrderPreference).default([]),
  rootAccentAssignments: stringRecord(z.string()).default({}),
  familyAccentAssignments: stringRecord(z.string()).default({}),
})
export type PersistedLayoutPreferences = z.infer<typeof PersistedLayoutPreferences>

export const FamilyData = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  members: stringRecord(Member),
  nicknameOverrides: NicknameOverrides.default({}),
  siblingOrders: SiblingOrders.default({}),
  /** @deprecated V2 手工坐标仅为兼容旧文件保留，新布局忽略。 */
  manualPositions: ManualPositions.default({}),
  childLayoutAssignments: ChildLayoutAssignments.default({}),
  /** @deprecated V2 slot order 仅为兼容旧文件保留，新写入使用 layoutPreferences。 */
  gridLayoutOverrides: GridLayoutOverrides.default({}),
  layoutPreferences: PersistedLayoutPreferences.prefault({}),
  rootMemberId: z.string().optional(),
  /** 上次使用的视角成员 id；打开项目时自动恢复并聚焦到该节点 */
  defaultViewpointId: z.string().optional(),
}).passthrough()
export type FamilyData = z.infer<typeof FamilyData>

// ---------------- ProjectMeta ----------------
export const ProjectMeta = z.object({
  name: z.string(),
  schemaVersion: z.number(),
  createdAt: z.string(), // ISO datetime
  updatedAt: z.string(),
})
export type ProjectMeta = z.infer<typeof ProjectMeta>

// ---------------- Factories ----------------
export function createEmptyFamily(): FamilyData {
  return {
    schemaVersion: SCHEMA_VERSION,
    members: {},
    nicknameOverrides: {},
    siblingOrders: {},
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
  }
}

export function createEmptyMeta(name: string): ProjectMeta {
  const now = new Date().toISOString()
  return {
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  }
}
