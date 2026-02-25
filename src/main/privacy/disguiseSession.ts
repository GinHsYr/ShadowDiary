import {
  activateDisguiseDatabase,
  createInMemoryDatabase,
  deactivateDisguiseDatabase,
  isDisguiseDatabaseActive
} from '../database'
import { seedDisguiseData } from './disguiseSeed'

export function isDisguiseModeEnabled(): boolean {
  return isDisguiseDatabaseActive()
}

export function enableDisguiseMode(): void {
  if (isDisguiseModeEnabled()) return

  const disguiseDb = createInMemoryDatabase()
  try {
    seedDisguiseData(disguiseDb)
    activateDisguiseDatabase(disguiseDb)
  } catch (error) {
    try {
      disguiseDb.close()
    } catch {
      // Ignore close error and rethrow the original failure.
    }
    throw error
  }
}

export function disableDisguiseMode(): void {
  if (!isDisguiseModeEnabled()) return
  deactivateDisguiseDatabase()
}

export function regenerateDisguiseModeData(): void {
  if (!isDisguiseModeEnabled()) {
    throw new Error('伪装模式未开启')
  }

  disableDisguiseMode()
  enableDisguiseMode()
}
