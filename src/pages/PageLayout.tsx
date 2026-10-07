import type { ReactNode } from 'react'
import { BRAND } from '../config/brand'
import { Logo } from '../ui/kit'

const base = import.meta.env.BASE_URL

export function PageLayout({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#0a0a0b] text-neutral-200">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <a href={base} className="flex items-center gap-2 font-semibold text-white"><Logo className="h-5 w-5 text-accent" />{BRAND.name}</a>
          <nav className="ml-auto flex gap-4 text-sm text-neutral-400">
            <a className="hover:text-white" href={`${base}methodology/`}>Methodology</a>
            <a className="hover:text-white" href={`${base}security/`}>Security</a>
            <a className="hover:text-white" href={BRAND.repoUrl}>Source code</a>
            <a className="rounded bg-accent px-2 py-0.5 font-medium text-black hover:bg-accent-strong" href={base}>Open app</a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1>
        <div className="mt-3 text-lg leading-relaxed text-neutral-400">{intro}</div>
        <div className="doc mt-10 space-y-10">{children}</div>
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-neutral-500">
        {BRAND.name} is free and open source (AGPL-3.0). Contains modified Copernicus Sentinel data. Landsat courtesy of the U.S. Geological Survey.
      </footer>
    </div>
  )
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="scroll-mt-6 text-xl font-semibold text-white"><a href={`#${id}`} className="hover:underline">{children}</a></h2>
}

export const code = (path: string) => `${BRAND.repoUrl}/blob/main/${path}`
