import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import { useUserStore } from './stores/user'
import { useThemeStore } from './stores/themes'
import router from './router'

// Prevent browser default file-drop navigation; editor components handle file drop explicitly.
const preventFileDropDefault = (event: DragEvent): void => {
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
}
window.addEventListener('dragenter', preventFileDropDefault, true)
window.addEventListener('dragover', preventFileDropDefault, true)
window.addEventListener('drop', preventFileDropDefault, true)

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

// 初始化用户信息（异步从数据库加载）
const userStore = useUserStore()
userStore.initFromStorage()

// 初始化主题设置（异步从数据库加载）
const themeStore = useThemeStore()
themeStore.initFromStorage()

let froalaLoader: Promise<void> | null = null

async function ensureFroalaLoaded(): Promise<void> {
  if (app.component('Froala')) return

  if (!froalaLoader) {
    froalaLoader = Promise.all([
      import('vue-froala-wysiwyg'),
      import('froala-editor/css/froala_editor.pkgd.min.css'),
      import('froala-editor/css/froala_style.min.css'),
      import('froala-editor/js/plugins.pkgd.min.js')
    ]).then(([{ default: VueFroala }]) => {
      app.use(VueFroala)
    })
  }

  await froalaLoader
}

router.beforeEach(async (to) => {
  if (to.path === '/today') {
    await ensureFroalaLoaded()
  }
})

async function bootstrap(): Promise<void> {
  app.use(router)
  await router.isReady()

  if (router.currentRoute.value.path === '/today') {
    await ensureFroalaLoaded()
  }

  app.mount('#app')
}

void bootstrap()
