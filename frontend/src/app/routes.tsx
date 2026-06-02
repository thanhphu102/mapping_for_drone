export function matchSpatialEditorProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/spatial-editor\/([^/]+)$/)
  return match?.[1] ?? null
}

function navigate(pathname: string) {
  if (window.location.pathname === pathname) {
    return
  }
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function openRootRoute() {
  window.location.assign('/')
}

export function openSpatialEditorRoute(projectId: string) {
  navigate(`/spatial-editor/${projectId}`)
}
