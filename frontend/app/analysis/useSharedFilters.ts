'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type DatePreset = 'this_year' | 'this_month' | 'this_week' | 'custom'

export interface Filters {
  datePreset: DatePreset
  startDate:  string
  endDate:    string
  shiftA:     boolean
  shiftB:     boolean
  model:      string
  defectMode: string
  line:       string
}

export function emptyFilters(): Filters {
  return { datePreset:'this_month', startDate:'', endDate:'', shiftA:true, shiftB:true, model:'', defectMode:'', line:'' }
}

// ── Encode / decode filters ↔ URLSearchParams ─────────────────────── //
function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  p.set('dp',  f.datePreset)
  if (f.startDate) p.set('sd', f.startDate)
  if (f.endDate)   p.set('ed', f.endDate)
  if (!f.shiftA)   p.set('sa', '0')
  if (!f.shiftB)   p.set('sb', '0')
  if (f.model)      p.set('m',  f.model)
  if (f.defectMode) p.set('dm', f.defectMode)
  if (f.line)       p.set('ln', f.line)
  return p
}

function paramsToFilters(sp: URLSearchParams): Filters {
  return {
    datePreset: (sp.get('dp') as DatePreset) ?? 'this_month',
    startDate:  sp.get('sd') ?? '',
    endDate:    sp.get('ed') ?? '',
    shiftA:     sp.get('sa') !== '0',
    shiftB:     sp.get('sb') !== '0',
    model:      sp.get('m')  ?? '',
    defectMode: sp.get('dm') ?? '',
    line:       sp.get('ln') ?? '',
  }
}

// ── Shared cache / flags (sessionStorage) ───────────────────────────//
const OPT_KEY  = 'az-filter-opts'
const NAV_FLAG = 'az-tab-nav'  // set before tab-switch, cleared on mount

export function loadCachedOpts(): { models: string[]; lines: string[]; defectModes: string[] } | null {
  try {
    const raw = sessionStorage.getItem(OPT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveCachedOpts(opts: { models: string[]; lines: string[]; defectModes: string[] }) {
  try { sessionStorage.setItem(OPT_KEY, JSON.stringify(opts)) } catch {}
}

/**
 * Returns true if this page mount came from a tab-switch (navigateTo).
 * Call once on mount — it auto-clears the flag so it fires only once.
 */
export function consumeTabNav(): boolean {
  try {
    const flag = sessionStorage.getItem(NAV_FLAG) === '1'
    sessionStorage.removeItem(NAV_FLAG)
    return flag
  } catch { return false }
}

// ── Main hook ────────────────────────────────────────────────────────//
export function useSharedFilters() {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [filters, setFiltersState] = useState<Filters>(() => paramsToFilters(searchParams))
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep filters in sync if URL changes from outside (e.g. back button)
  useEffect(() => {
    setFiltersState(paramsToFilters(searchParams))
  }, [searchParams.toString()]) // eslint-disable-line

  const setFilters = useCallback((next: Filters, onCommit?: (f: Filters) => void) => {
    setFiltersState(next)
    const params = filtersToParams(next)
    router.replace(`${pathname}?${params}`, { scroll: false })
    if (onCommit) {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
      fetchTimerRef.current = setTimeout(() => onCommit(next), 300)
    }
  }, [router, pathname])

  // Sets NAV_FLAG before navigating so destination page can skip loading UI
  const navigateTo = useCallback((href: string) => {
    try { sessionStorage.setItem(NAV_FLAG, '1') } catch {}
    const params = filtersToParams(filters)
    router.push(`${href}?${params}`)
  }, [router, filters])

  const updateFilter = useCallback(<K extends keyof Filters>(
    key: K, value: Filters[K], onCommit?: (f: Filters) => void
  ) => {
    setFiltersState(prev => {
      const next = { ...prev, [key]: value }
      setTimeout(() => {
        const params = filtersToParams(next)
        router.replace(`${pathname}?${params}`, { scroll: false })
        if (onCommit) {
          if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
          fetchTimerRef.current = setTimeout(() => onCommit(next), 300)
        }
      }, 0)
      return next
    })
  }, [router, pathname])

  return { filters, setFilters, updateFilter, navigateTo, pathname }
}