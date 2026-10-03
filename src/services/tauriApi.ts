import { open } from '@tauri-apps/plugin-dialog'

/** 让用户选择一个文件夹（新建/打开项目均用此） */
export async function pickDirectory(title: string): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title })
  if (!result) return null
  return typeof result === 'string' ? result : null
}
