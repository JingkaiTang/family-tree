import type { ProjectRef } from './projectRef'
import type { FamilyData, ProjectMeta } from '@/core/schema'
import { pickProject, readPhoto } from './storage'

export interface ProjectImportResult {
  project: ProjectRef
  meta: ProjectMeta
}

export interface ProjectExportSnapshot {
  meta: ProjectMeta
  family: FamilyData
}

/** 在用户选择的空目录中流式导入备份，不依赖应用托管目录。 */
export async function importProjectBundle(file: File): Promise<ProjectImportResult | null> {
  // Pick before loading codecs or reading the archive: this call owns the click.
  const target = await pickProject('browser-directory', 'create')
  if (!target) return null
  const { importBrowserProjectBundle } = await import('./storage/browserDirectory')
  const created = await importBrowserProjectBundle(target.id, file)
  return { project: { ...target, id: created.id, displayName: created.displayName }, meta: created.meta }
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
    excludeAcceptAllOption: boolean
  }) => Promise<FileSystemFileHandle>
}

/** Select a destination in the click handler; the returned operation runs after saving. */
export async function prepareProjectBundleExport(project: ProjectRef): Promise<((snapshot?: ProjectExportSnapshot) => Promise<boolean>) | null> {
  if (project.providerId !== 'browser-directory') throw new Error('此存储不支持浏览器备份导出')
  const picker = typeof window !== 'undefined' && (window as SavePickerWindow).showSaveFilePicker
  if (!picker) throw new Error('此浏览器不支持保存备份文件；可以直接复制项目目录进行备份。')
  const name = project.displayName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || '家族备份'
  let destination: FileSystemFileHandle
  try {
    destination = await picker.call(window, {
      suggestedName: `${name}.familybundle`,
      types: [{ description: '家族备份', accept: { 'application/zip': ['.familybundle'] } }],
      excludeAcceptAllOption: true,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null
    throw error
  }
  if (!destination.name.endsWith('.familybundle')) throw new Error('备份文件名必须以 .familybundle 结尾')
  let started = false
  return async (snapshot) => {
    if (started) throw new Error('请重新选择备份保存位置')
    started = true
    if (!snapshot) throw new Error('导出前需要已保存的项目快照')
    const { exportProjectBundleToStream } = await import('./storage/projectBundle')
    const output = await destination.createWritable()
    await exportProjectBundleToStream({
      meta: snapshot.meta,
      family: snapshot.family,
      readPhoto: (id, thumb) => readPhoto(project, id, thumb),
    }, output)
    return true
  }
}
