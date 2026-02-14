import { defineStore } from 'pinia'
import type { UserInfo } from '../../../types/model'

export const useUserStore = defineStore('user', {
  state: () => ({
    name: '用户名',
    avatar: ''
  }),

  getters: {
    getUserInfo(state): UserInfo {
      return {
        name: state.name,
        avatar: state.avatar
      }
    },
    getInitial(state): string {
      return state.name ? state.name.charAt(0) : '?'
    }
  },

  actions: {
    // 初始化：从 settings 表加载数据
    async initFromStorage() {
      try {
        const settings = await window.api.getAllSettings()
        this.name = settings['user.name'] || '用户名'
        this.avatar = settings['user.avatar'] || ''
      } catch (error) {
        console.error('加载用户信息失败:', error)
      }
    },

    // 更新用户信息并保存到 settings 表
    async updateUserInfo(userInfo: Partial<UserInfo>) {
      if (userInfo.name !== undefined) {
        this.name = userInfo.name
        await window.api.setSetting('user.name', userInfo.name)
      }
      if (userInfo.avatar !== undefined) {
        this.avatar = userInfo.avatar
        await window.api.setSetting('user.avatar', userInfo.avatar)
      }
    },

    // 清除用户信息
    async clearUserInfo() {
      this.name = '用户名'
      this.avatar = ''
      await window.api.setSetting('user.name', '')
      await window.api.setSetting('user.avatar', '')
    }
  }
})
