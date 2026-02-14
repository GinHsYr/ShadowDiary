import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import { useUserStore } from './stores/user'
import { useThemeStore } from './stores/themes'
import router from './router'

// 导入 Froala 编辑器
import VueFroala from 'vue-froala-wysiwyg'
import 'froala-editor/css/froala_editor.pkgd.min.css'
import 'froala-editor/css/froala_style.min.css'
import 'froala-editor/js/plugins.pkgd.min.js'

const app = createApp(App)
app.use(VueFroala)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// 初始化用户信息（异步从数据库加载）
const userStore = useUserStore()
userStore.initFromStorage()

// 初始化主题设置（异步从数据库加载）
const themeStore = useThemeStore()
themeStore.initFromStorage()

app.mount('#app')
