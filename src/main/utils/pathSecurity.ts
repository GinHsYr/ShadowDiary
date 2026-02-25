import { isAbsolute, relative, resolve } from 'path'

function assertNoNullByte(value: string, fieldName: string): void {
  if (value.includes('\u0000')) {
    throw new Error(`${fieldName} contains null byte`)
  }
}

export function assertPathInSubdir(baseDir: string, relativePath: string): string {
  if (!relativePath) {
    throw new Error('relativePath is required')
  }

  assertNoNullByte(baseDir, 'baseDir')
  assertNoNullByte(relativePath, 'relativePath')

  if (isAbsolute(relativePath)) {
    throw new Error('relativePath must not be absolute')
  }

  const resolvedBaseDir = resolve(baseDir)
  const resolvedPath = resolve(resolvedBaseDir, relativePath)
  const rel = relative(resolvedBaseDir, resolvedPath)

  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes base directory')
  }

  return resolvedPath
}
