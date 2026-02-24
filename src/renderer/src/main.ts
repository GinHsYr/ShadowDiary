import { createApp, watch } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import { useUserStore } from './stores/user'
import { useThemeStore } from './stores/themes'
import { usePrivacyStore } from './stores/privacy'
import { useLocaleStore } from './stores/locale'
import router from './router'
import { i18n } from './i18n'

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
app.use(i18n)

const userStore = useUserStore()
const themeStore = useThemeStore()
const privacyStore = usePrivacyStore()
const localeStore = useLocaleStore()

let appDataInitialized = false

async function initUnlockedAppData(): Promise<void> {
  if (appDataInitialized) return
  appDataInitialized = true

  await Promise.all([userStore.initFromStorage(), themeStore.initFromStorage()])
}

let froalaLoader: Promise<void> | null = null

async function ensureFroalaLoaded(): Promise<void> {
  if (app.component('Froala')) return

  if (!froalaLoader) {
    froalaLoader = Promise.all([
      import('vue-froala-wysiwyg'),
      import('froala-editor/css/froala_editor.pkgd.min.css'),
      import('froala-editor/css/froala_style.min.css'),
      import('froala-editor/js/plugins.pkgd.min.js'),
      import('froala-editor/js/languages/zh_cn.js'),
      import('froala-editor/js/languages/ja.js'),
      import('froala-editor/js/languages/ko.js')
    ]).then(([{ default: VueFroala }]) => {
      app.use(VueFroala)
    })
  }

  await froalaLoader
}

router.beforeEach(async (to) => {
  if (to.path === '/today' && !privacyStore.isLocked) {
    await ensureFroalaLoaded()
  }
})

async function bootstrap(): Promise<void> {
  await localeStore.initFromStorage()
  await privacyStore.initFromStorage()
  if (!privacyStore.isLocked) {
    await initUnlockedAppData()
  }

  watch(
    () => [privacyStore.isInitialized, privacyStore.isLocked] as const,
    async ([isInitialized, isLocked]) => {
      if (!isInitialized || isLocked) return
      await initUnlockedAppData()
      if (router.currentRoute.value.path === '/today') {
        await ensureFroalaLoaded()
      }
    },
    { immediate: true }
  )

  app.use(router)
  await router.isReady()

  if (router.currentRoute.value.path === '/today' && !privacyStore.isLocked) {
    await ensureFroalaLoaded()
  }

  app.mount('#app')
}

void bootstrap()
