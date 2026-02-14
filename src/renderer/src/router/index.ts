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
    path: '/calendar',
    name: 'Calendar',
    component: () => import('../views/calendar/index.vue')
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
