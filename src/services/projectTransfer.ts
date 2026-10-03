import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ProjectRef } from './projectRef'
import type { FamilyData, ProjectMeta } from '@/core/schema'
import type { ManagedProjectSummary } from './projectRepository'
import { fromNativeProject, requireNativeStorage, toNativeProject, type NativeProjectRef } from './storage/tauri'
import { pickProject, readPhoto } from './storage'

export interface ProjectExportSnapshot {
  meta: ProjectMeta
  family: FamilyData
}

/** 原生层完成选择、有界流传输和缓存清理，WebView 不获得通用文件 IO 权限。 */
export async function importProjectBundle(file?: File): Promise<ManagedProjectSummary | null> {
  if (!isTauri()) {
    if (!file) throw new Error('请先选择家族备份，再选择用于导入的空目录。')
    // Pick before loading codecs or reading the archive: this call owns the click.
    const target = await pickProject('browser-directory', 'create')
    if (!target) return null
    const { importBrowserProjectBundle } = await import('./storage/browserDirectory')
    const created = await importBrowserProjectBundle(target.id, file)
    return { project: { ...target, id: created.id, displayName: created.displayName }, meta: created.meta }
  }
  requireNativeStorage()
  const imported = await invoke<{ project: NativeProjectRef; meta: ProjectMeta } | null>(
    'import_project_bundle_from_picker',
  )
  return imported
    ? { project: fromNativeProject(imported.project, imported.meta.name), meta: imported.meta }
    : null
}

export async function exportProjectBundle(project: ProjectRef, snapshot?: ProjectExportSnapshot): Promise<boolean> {
  const prepared = await prepareProjectBundleExport(project)
  return prepared ? prepared(snapshot) : false
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
  if (project.providerId === 'tauri-local' || project.providerId === 'tauri-managed') {
    requireNativeStorage()
    const nativeProject = toNativeProject(project)
    return () => invoke<boolean>('export_project_bundle_to_picker', { project: nativeProject })
  }
  if (project.providerId !== 'browser-directory') throw new Error('此存储不支持原生项目传输或浏览器备份导出')
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
