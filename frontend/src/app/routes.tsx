export function matchSpatialEditorProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/spatial-editor\/([^/]+)$/)
  return match?.[1] ?? null
}

export function openRootRoute() {
  window.location.assign('/')
}
