import { open, save } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, copyFile, mkdir, remove } from '@tauri-apps/plugin-fs'
import { v4 as uuidv4 } from 'uuid'
import type { ProjectRef } from './projectRef'
import { projectRepository, type ManagedProjectSummary } from './projectRepository'

const TRANSFERS_DIR = 'transfers'
const BUNDLE_EXTENSION = 'familybundle'

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
    await copyFile(selected, cachePath(transferName), {
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
    await copyFile(cachePath(generated.transferName), destination, {
      fromPathBaseDir: BaseDirectory.AppCache,
    })
    return true
  } finally {
    await cleanupTransfer(generated.transferName)
  }
}
