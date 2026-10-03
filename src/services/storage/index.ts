import { createStorage } from './storage'
import { tauriManagedStorage, tauriProjectPicker, tauriStorage } from './tauri'
import { browserDirectoryStorage, browserDirectoryPicker } from './browserDirectory'

export type { ProjectRef, ProjectPicker, ProjectStorageProvider, StoredProject, CreatedProject } from './types'
export { createStorage } from './storage'
export { getDirectoryStorageAvailability } from './browserDirectory'

/** 应用装配点：增加提供商时在这里接入，业务与 UI 不导入具体适配器。 */
export const {
  registerProvider,
  registerPicker,
  authorizeProject,
  pickProject,
  createProject,
  loadProject,
  saveProject,
  importPhoto,
  readPhoto,
  resolvePhotoUrl,
  deletePhoto,
  supportsMediaGc,
  gcMedia,
} = createStorage(
  [tauriStorage, tauriManagedStorage, browserDirectoryStorage],
  [tauriProjectPicker, browserDirectoryPicker],
)
