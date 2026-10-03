<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'

const updateReady = ref(false)
const dismissed = ref(false)
const registrationFailed = ref(false)
let disposed = false
let cleanup: (() => void) | undefined

onMounted(async () => {
  if (!import.meta.env.PROD || isTauri() || !('serviceWorker' in navigator)) return

  try {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI)
    const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
    })
    if (disposed) return

    const detectUpdate = () => {
      // An initial installation has no previous controller and needs no prompt.
      if (registration.waiting && navigator.serviceWorker.controller) updateReady.value = true
      // Registration can succeed even when precaching fails during install.
      // A failed update must not hide the older working offline version.
      if (installing?.state === 'redundant' && !registration.active && !navigator.serviceWorker.controller) {
        registrationFailed.value = true
      }
    }
    let installing = registration.installing
    const onStateChange = () => detectUpdate()
    const onUpdateFound = () => {
      installing?.removeEventListener('statechange', onStateChange)
      installing = registration.installing
      installing?.addEventListener('statechange', onStateChange)
      detectUpdate()
    }
    installing?.addEventListener('statechange', onStateChange)
    registration.addEventListener('updatefound', onUpdateFound)
    cleanup = () => {
      installing?.removeEventListener('statechange', onStateChange)
      registration.removeEventListener('updatefound', onUpdateFound)
    }
    detectUpdate()
    // Deliberately never send SKIP_WAITING or reload on controllerchange. An
    // update activates after all old windows close, including other editors.
  } catch {
    if (!disposed) registrationFailed.value = true
  }
})

onUnmounted(() => {
  disposed = true
  cleanup?.()
})
</script>

<template>
  <aside
    v-if="!dismissed && (updateReady || registrationFailed)"
    role="status"
    class="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-sky-200 bg-white p-4 text-sm text-slate-700 shadow-lg"
  >
    <p class="flex-1">
      {{ updateReady
        ? '新版已准备好。保存并关闭所有家族树窗口后，重新打开即可更新。'
        : '离线资源准备失败，联网时仍可使用。下次打开时会重试。' }}
    </p>
    <button type="button" class="shrink-0 text-sky-700" @click="dismissed = true">知道了</button>
  </aside>
</template>
