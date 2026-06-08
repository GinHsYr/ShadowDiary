const ARCHIVE_ALIAS_SEPARATOR_RE = /[,，、；;\n\r]+/g

export function splitArchiveAliases(alias: string | null | undefined): string[] {
  if (!alias) return []
  return alias
    .split(ARCHIVE_ALIAS_SEPARATOR_RE)
    .map((item) => item.trim())
    .filter(Boolean)
}
