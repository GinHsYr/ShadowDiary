import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/dashboard/index.vue')
  },
  {
    path: '/today',
    name: 'Today',
    component: () => import('../views/today/index.vue')
  },
  {
    path: '/archives',
    name: 'Archives',
    component: () => import('../views/archives/index.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/settings/index.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
