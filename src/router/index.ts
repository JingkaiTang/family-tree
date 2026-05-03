import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'welcome',
    component: () => import('@/pages/Welcome.vue'),
  },
  {
    path: '/tree',
    name: 'tree',
    component: () => import('@/pages/TreeView.vue'),
  },
  {
    path: '/member/:id',
    name: 'member',
    component: () => import('@/pages/MemberDetail.vue'),
    props: true,
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
