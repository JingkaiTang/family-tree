import type { FamilyData } from '@/core/schema'
import type { ProjectPicker, ProjectRef, ProjectStorageProvider } from './types'

/** 以明确的项目引用路由每一次操作，不维护“当前活动提供商”。 */
export function createStorage(
  initialProviders: readonly ProjectStorageProvider[] = [],
  initialPickers: readonly ProjectPicker[] = [],
) {
  const providers = new Map<string, ProjectStorageProvider>()
  const pickers = new Map<string, ProjectPicker>()

  function registerProvider(provider: ProjectStorageProvider) {
    if (!provider.id || providers.has(provider.id)) {
      throw new Error(`存储提供商标识为空或重复：${provider.id}`)
    }
    providers.set(provider.id, provider)
  }

  function getProvider(providerId: string): ProjectStorageProvider {
    const provider = providers.get(providerId)
    if (!provider) throw new Error(`存储提供商尚未连接：${providerId}`)
    return provider
  }

  function registerPicker(picker: ProjectPicker) {
    getProvider(picker.providerId)
    if (pickers.has(picker.providerId)) {
      throw new Error(`项目选择器重复：${picker.providerId}`)
    }
    pickers.set(picker.providerId, picker)
  }

  for (const provider of initialProviders) registerProvider(provider)
  for (const picker of initialPickers) registerPicker(picker)

  return {
    registerProvider,
    hasProvider(providerId: string): boolean {
      return providers.has(providerId)
    },
    registerPicker,
    async authorizeProject(ref: ProjectRef): Promise<void> {
      getProvider(ref.providerId)
      await pickers.get(ref.providerId)?.authorizeProject?.(ref.id)
    },
    async pickProject(providerId: string, mode: 'create' | 'open'): Promise<ProjectRef | null> {
      getProvider(providerId)
      const picker = pickers.get(providerId)
      if (!picker) throw new Error(`此存储尚未提供项目选择器：${providerId}`)
      const selected = await picker.pickProject(mode)
      return selected ? { providerId, id: selected.id, displayName: selected.displayName } : null
    },
    async createProject(target: ProjectRef, name: string) {
      const providerId = target.providerId
      const created = await getProvider(providerId).createProject(target.id, name)
      return {
        ref: { providerId, id: created.id, displayName: created.displayName },
        meta: created.meta,
      }
    },
    async loadProject(ref: ProjectRef) {
      const providerId = ref.providerId
      const loaded = await getProvider(providerId).loadProject(ref.id)
      return {
        ref: { providerId, id: loaded.id, displayName: loaded.displayName },
        meta: loaded.meta,
        family: loaded.family,
      }
    },
    async saveProject(ref: ProjectRef, family: FamilyData): Promise<void> {
      await getProvider(ref.providerId).saveProject(ref.id, family)
    },
    async renameProject(ref: ProjectRef, name: string) {
      const provider = getProvider(ref.providerId)
      if (!provider.renameProject) throw new Error('此存储不支持重命名')
      const result = await provider.renameProject(ref.id, name)
      return {
        project: { providerId: ref.providerId, id: result.id, displayName: result.displayName },
        meta: result.meta,
        warning: result.warning,
      }
    },
    async importPhoto(ref: ProjectRef, bytes: Uint8Array, mime: string) {
      return getProvider(ref.providerId).importPhoto(ref.id, bytes, mime)
    },
    async readPhoto(ref: ProjectRef, photoId: string, thumb = false): Promise<Blob> {
      return getProvider(ref.providerId).readPhoto(ref.id, photoId, thumb)
    },
    /** 调用方在替换图片、丢弃过期结果或卸载时释放 Blob URL。 */
    async resolvePhotoUrl(ref: ProjectRef, photoId: string, thumb = false): Promise<string> {
      const blob = await getProvider(ref.providerId).readPhoto(ref.id, photoId, thumb)
      return URL.createObjectURL(blob)
    },
    async deletePhoto(ref: ProjectRef, photoId: string): Promise<void> {
      await getProvider(ref.providerId).deletePhoto(ref.id, photoId)
    },
    supportsMediaGc(ref: ProjectRef): boolean {
      return typeof providers.get(ref.providerId)?.gcMedia === 'function'
    },
    async gcMedia(ref: ProjectRef, usedIds: string[]): Promise<number> {
      const provider = getProvider(ref.providerId)
      if (!provider.gcMedia) throw new Error('此存储不支持安全清理未引用的照片')
      return provider.gcMedia(ref.id, usedIds)
    },
  }
}
