import type { ReactNode } from 'react'

interface EditorLayoutProps {
  structurePanel: ReactNode
  mapSurface: ReactNode
  sidebar: ReactNode
}

export function EditorLayout({
  structurePanel,
  mapSurface,
  sidebar,
}: EditorLayoutProps) {
  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-slate-100 text-slate-950">
      {structurePanel}
      {mapSurface}
      {sidebar}
    </div>
  )
}

