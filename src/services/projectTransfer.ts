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

export type ProjectExportResult =
  | { kind: 'saved' }
  | { kind: 'download'; blob: Blob; filename: string }

// Browsers without a destination picker retain the archive until the user downloads it.
export const DOWNLOAD_BUNDLE_MAX_BYTES = 128 * 1024 * 1024

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

/** Select a destination in the click handler, or prepare a bounded browser download. */
export async function prepareProjectBundleExport(project: ProjectRef): Promise<((snapshot?: ProjectExportSnapshot) => Promise<ProjectExportResult>) | null> {
  const picker = typeof window !== 'undefined' && (window as SavePickerWindow).showSaveFilePicker
  const name = project.displayName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || '家族备份'
  const filename = `${name}.familybundle`
  let destination: FileSystemFileHandle | undefined
  if (picker) {
    try {
      destination = await picker.call(window, {
        suggestedName: filename,
        types: [{ description: '家族备份', accept: { 'application/zip': ['.familybundle'] } }],
        excludeAcceptAllOption: true,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return null
      throw error
    }
    if (!destination.name.endsWith('.familybundle')) throw new Error('备份文件名必须以 .familybundle 结尾')
  }
  let started = false
  return async (snapshot) => {
    if (started) throw new Error('请重新选择备份保存位置或重新准备下载')
    started = true
    if (!snapshot) throw new Error('导出前需要项目快照')
    const { exportProjectBundleToStream } = await import('./storage/projectBundle')
    const chunks: Blob[] = []
    let bytes = 0
    const output = destination ? await destination.createWritable() : new WritableStream<Uint8Array>({
      write(chunk) {
        bytes += chunk.byteLength
        if (bytes > DOWNLOAD_BUNDLE_MAX_BYTES) {
          throw new Error('此浏览器的下载备份上限为 128 MiB；请使用支持保存文件选择器的桌面浏览器导出较大备份。')
        }
        // Blob snapshots each chunk; a producer may reuse its Uint8Array afterwards.
        chunks.push(new Blob([new Uint8Array(chunk)]))
      },
      abort() { chunks.length = 0 },
    })
    try {
      await exportProjectBundleToStream({
        meta: snapshot.meta,
        family: snapshot.family,
        async readPhoto(id, thumb) {
          try {
            return await readPhoto(project, id, thumb)
          } catch (error) {
            throw new Error('无法读取照片，未生成完整备份。请检查网络及存储授权后重试：'
              + (error instanceof Error ? error.message : String(error)), { cause: error })
          }
        },
      }, output)
      return destination ? { kind: 'saved' } : {
        kind: 'download', blob: new Blob(chunks, { type: 'application/zip' }), filename,
      }
    } finally {
      chunks.length = 0
    }
  }
}
