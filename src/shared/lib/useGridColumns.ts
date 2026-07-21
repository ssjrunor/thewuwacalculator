/*
  Author: Runor Ewhro
  Description: Reads the live column count of a CSS grid so entrance
               animations can stagger by row instead of by flat index, since
               auto-fill/auto-fit column counts change continuously with
               viewport width and can't be known from CSS alone.
*/

import { useCallback, useRef, useState } from 'react'
import type { RefCallback } from 'react'

export function useGridColumns(): [RefCallback<HTMLElement>, number] {
  const [columns, setColumns] = useState(1)
  const observerRef = useRef<ResizeObserver | null>(null)

  const setRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null

    if (!el) {
      return
    }

    const measure = () => {
      const trackCount = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
      setColumns(trackCount > 0 ? trackCount : 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observerRef.current = observer
  }, [])

  return [setRef, columns]
}
