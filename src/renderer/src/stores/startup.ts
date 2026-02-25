import { defineStore } from 'pinia'

export const useStartupStore = defineStore('startup', {
  state: () => ({
    isBooting: true
  }),

  actions: {
    finishBoot(): void {
      this.isBooting = false
    }
  }
})
