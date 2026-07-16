import { layoutFamilyTreeSync } from './treeLayoutCore'
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './treeLayoutProtocol'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null
  postMessage: (message: LayoutWorkerResponse) => void
}

workerScope.onmessage = (event) => {
  const { id, members, options } = event.data
  try {
    workerScope.postMessage({
      id,
      ok: true,
      scene: layoutFamilyTreeSync(members, options),
    })
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
