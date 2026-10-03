/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_DRIVE_CLIENT_ID?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<object, object, any>
  export default component
}
