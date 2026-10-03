import { open, save } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, open as openFile, mkdir, remove, type FileHandle } from '@tauri-apps/plugin-fs'
import { v4 as uuidv4 } from 'uuid'
import type { ProjectRef } from './projectRef'
import { projectRepository, type ManagedProjectSummary } from './projectRepository'

const TRANSFERS_DIR = 'transfers'
const BUNDLE_EXTENSION = 'familybundle'
const TRANSFER_BUFFER_BYTES = 64 * 1024

function cachePath(transferName: string): string {
  return `${TRANSFERS_DIR}/${transferName}`
}

async function ensureTransferDirectory() {
  await mkdir(TRANSFERS_DIR, { baseDir: BaseDirectory.AppCache, recursive: true })
}

async function cleanupTransfer(transferName: string) {
  try {
    await remove(cachePath(transferName), { baseDir: BaseDirectory.AppCache })
  } catch {
    // 临时文件可能尚未创建，或已经由平台清理。
  }
}

async function streamBundle(
  sourcePath: string,
  destinationPath: string,
  options: { fromPathBaseDir?: BaseDirectory; toPathBaseDir?: BaseDirectory },
) {
  // File handles support Android content URIs; copyFile only resolves filesystem paths.
  const source = await openFile(sourcePath, { read: true, baseDir: options.fromPathBaseDir })
  let destination: FileHandle | undefined
  let transferFailed = false
  try {
    destination = await openFile(destinationPath, {
      write: true,
      create: true,
      truncate: true,
      baseDir: options.toPathBaseDir,
    })
    const buffer = new Uint8Array(TRANSFER_BUFFER_BYTES)
    for (;;) {
      const count = await source.read(buffer)
      if (count === null) break
      let offset = 0
      while (offset < count) {
        const written = await destination.write(buffer.subarray(offset, count))
        if (written === 0) throw new Error('备份文件写入未取得进展')
        offset += written
      }
    }
  } catch (error) {
    transferFailed = true
    throw error
  } finally {
    const results = await Promise.allSettled([source.close(), destination?.close()])
    const closeFailure = results.find(result => result.status === 'rejected')
    if (!transferFailed && closeFailure?.status === 'rejected') throw closeFailure.reason
  }
}

export async function importProjectBundle(): Promise<ManagedProjectSummary | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    pickerMode: 'document',
    fileAccessMode: 'copy',
    filters: [{ name: '家族备份', extensions: [BUNDLE_EXTENSION] }],
  })
  if (!selected || Array.isArray(selected)) return null

  const transferName = `${uuidv4()}.${BUNDLE_EXTENSION}`
  await ensureTransferDirectory()
  try {
    await streamBundle(selected, cachePath(transferName), {
      toPathBaseDir: BaseDirectory.AppCache,
    })
    return await projectRepository.importBundle(transferName)
  } finally {
    await cleanupTransfer(transferName)
  }
}

export async function exportProjectBundle(
  project: ProjectRef,
): Promise<boolean> {
  const generated = await projectRepository.exportBundle(project)
  try {
    const destination = await save({
      defaultPath: generated.suggestedName,
      filters: [{ name: '家族备份', extensions: [BUNDLE_EXTENSION] }],
    })
    if (!destination) return false
    await streamBundle(cachePath(generated.transferName), destination, {
      fromPathBaseDir: BaseDirectory.AppCache,
    })
    return true
  } finally {
    await cleanupTransfer(generated.transferName)
  }
}
