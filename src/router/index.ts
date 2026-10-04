import { createRouter, createWebHashHistory, type RouteLocationNormalized, type RouteRecordRaw, type RouterHistory } from 'vue-router'
import { useFamilyStore } from '@/stores/family'
import { useUiStore } from '@/stores/ui'
import { flushNow } from '@/services/autosave'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'welcome',
    component: () => import('@/pages/Welcome.vue'),
  },
  {
    path: '/tree',
    name: 'tree',
    meta: { requiresProject: true },
    component: () => import('@/pages/TreeView.vue'),
  },
  {
    path: '/members/new',
    name: 'member-new',
    meta: { requiresProject: true },
    component: () => import('@/pages/MemberDetail.vue'),
  },
  {
    path: '/member/:id',
    name: 'member',
    meta: { requiresProject: true },
    component: () => import('@/pages/MemberDetail.vue'),
    props: true,
  },
]

export function createAppRouter(history: RouterHistory = createWebHashHistory()) {
  const router = createRouter({ history, routes })
  const closingProjects = new WeakMap<RouteLocationNormalized, number>()
  router.beforeEach((to) => {
    // 刷新项目页面时内存 store 尚未恢复，统一交给 Welcome 读取最近项目和处理授权。
    if (to.meta.requiresProject && !useFamilyStore().projectRef) {
      return { name: 'welcome', replace: true }
    }
  })
  router.beforeResolve(async (to, from) => {
    const family = useFamilyStore()
    if (from.meta.requiresProject && !to.meta.requiresProject && family.projectRef) {
      const projectToken = family.projectToken
      try {
        // 在离开组件的草稿守卫和目标页面懒加载之后保存，覆盖等待加载期间发生的编辑。
        // 浏览器后退也必须等待落盘；失败时留在当前项目，不自动弹出授权窗口。
        await flushNow()
      } catch (error) {
        useUiStore().showToast('error', '保存失败，项目保持打开：'
          + (error instanceof Error ? error.message : String(error)))
        return false
      }
      if (family.projectToken !== projectToken) return false
      closingProjects.set(to, projectToken)
    }
  })
  router.afterEach((to, _from, failure) => {
    const projectToken = closingProjects.get(to)
    closingProjects.delete(to)
    const family = useFamilyStore()
    // 等待保存期间用户可能发起另一条导航；只有成功离开的那条导航才能关闭会话。
    if (failure || projectToken === undefined || family.projectToken !== projectToken) return
    const ui = useUiStore()
    ui.setViewpoint(null)
    ui.setSelected(null)
    ui.setShowAuxiliaryRelations(false)
    ui.setCanvasView(null)
    ui.resetFocusFlowState()
    family.closeProject()
  })
  return router
}

export const router = createAppRouter()
