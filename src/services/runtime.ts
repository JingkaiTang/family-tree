import { invoke } from '@tauri-apps/api/core'

export type RuntimePlatform = 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'web'

export function isMobilePlatform(platform: RuntimePlatform): boolean {
  return platform === 'android' || platform === 'ios'
}

export async function getRuntimePlatform(): Promise<RuntimePlatform> {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return 'web'
  }
  const platform = await invoke<string>('runtime_platform')
  if (
    platform === 'android'
    || platform === 'ios'
    || platform === 'linux'
    || platform === 'macos'
    || platform === 'windows'
  ) return platform
  return 'web'
}
