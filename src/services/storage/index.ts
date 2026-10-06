import { createStorage } from './storage'
import { browserDirectoryStorage, browserDirectoryPicker } from './browserDirectory'
import { connectGoogleDrive, isGoogleDriveProvider, registerGoogleDriveProviders } from '../googleDriveConnection'
import type { ProjectRef } from './types'

export type { ProjectRef, ProjectPicker, ProjectStorageProvider, StoredProject, CreatedProject } from './types'
export { createStorage } from './storage'
export { getDirectoryStorageAvailability } from './browserDirectory'

/** 应用装配点：增加提供商时在这里接入，业务与 UI 不导入具体适配器。 */
const storage = createStorage([browserDirectoryStorage], [browserDirectoryPicker])
registerGoogleDriveProviders(storage.registerProvider)

export async function authorizeProject(ref: ProjectRef): Promise<void> {
  if (isGoogleDriveProvider(ref.providerId)) await connectGoogleDrive(ref.providerId)
  await storage.authorizeProject(ref)
}

export const {
  registerProvider,
  hasProvider,
  registerPicker,
  pickProject,
  createProject,
  loadProject,
  saveProject,
  renameProject,
  importPhoto,
  readPhoto,
  resolvePhotoUrl,
  deletePhoto,
  supportsMediaGc,
  gcMedia,
} = storage
