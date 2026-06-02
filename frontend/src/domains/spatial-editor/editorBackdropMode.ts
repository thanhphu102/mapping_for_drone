export type EditorBackdropMode = 'white' | 'map'

const editorBackdropModeStorageKey = 'swarm-gsc-spatial-editor-backdrop-mode'

export function readStoredEditorBackdropMode(): EditorBackdropMode {
  if (typeof window === 'undefined') {
    return 'white'
  }
  return window.localStorage.getItem(editorBackdropModeStorageKey) === 'map'
    ? 'map'
    : 'white'
}

export function writeStoredEditorBackdropMode(mode: EditorBackdropMode) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(editorBackdropModeStorageKey, mode)
}
