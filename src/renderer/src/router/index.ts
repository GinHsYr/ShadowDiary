import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    meta: {
      navOrder: 0
    },
    component: () => import('../views/dashboard/index.vue')
  },
  {
    path: '/today',
    name: 'Today',
    meta: {
      navOrder: 1
    },
    component: () => import('../views/today/index.vue')
  },
  {
    path: '/archives',
    name: 'Archives',
    meta: {
      navOrder: 2
    },
    component: () => import('../views/archives/index.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    meta: {
      navOrder: 3
    },
    component: () => import('../views/settings/index.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
