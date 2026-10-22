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
  const departureSessions = new WeakMap<RouteLocationNormalized, { projectToken: number; draftRevision: number }>()
  router.beforeEach((to, from) => {
    const family = useFamilyStore()
    if (to.name === 'member-new' && family.projectRef && !family.canEdit) {
      return { name: 'tree', replace: true }
    }
    // 刷新项目页面时内存 store 尚未恢复，统一交给 Welcome 读取最近项目和处理授权。
    if (to.meta.requiresProject && !family.projectRef) {
      return { name: 'welcome', replace: true }
    }
    if (from.meta.requiresProject && !to.meta.requiresProject && family.projectRef) {
      // 组件草稿守卫已通过，但目标页面尚未懒加载；把此刻的确认绑定到本次导航。
      departureSessions.set(to, {
        projectToken: family.projectToken,
        draftRevision: useUiStore().memberDraftRevision,
      })
    }
  })
  router.beforeResolve(async (to, from) => {
    const family = useFamilyStore()
    if (from.meta.requiresProject && !to.meta.requiresProject && family.projectRef) {
      const departure = departureSessions.get(to)
      if (!departure) return false
      const ui = useUiStore()
      const canLeave = () => {
        if (family.projectToken !== departure.projectToken) return false
        if (ui.memberDraftRevision === departure.draftRevision) return true
        if (router.currentRoute.value === from) {
          ui.showToast('info', '等待离开期间资料发生变化，项目保持打开。请先保存或放弃资料，再返回。')
        }
        return false
      }
      if (!canLeave()) return false
      try {
        // 资料草稿仍由成员页拥有；只刷新已提交到 store 的修改。
        // 浏览器后退也必须等待落盘；失败时留在当前项目，不自动弹出授权窗口。
        await flushNow()
      } catch (error) {
        useUiStore().showToast('error', '保存失败，项目保持打开：'
          + (error instanceof Error ? error.message : String(error)))
        return false
      }
      if (!canLeave()) return false
      closingProjects.set(to, departure.projectToken)
    }
  })
  router.afterEach((to, _from, failure) => {
    const projectToken = closingProjects.get(to)
    closingProjects.delete(to)
    departureSessions.delete(to)
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
