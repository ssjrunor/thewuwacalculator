/*
  Author: Runor Ewhro
  Description: Combines multiple refs targeting the same element into one
               callback ref, for spots where a DOM node needs to satisfy an
               existing ref (e.g. selection scoping) alongside a local one.
*/

import type { MutableRefObject, Ref, RefCallback } from 'react'

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) {
        continue
      }

      if (typeof ref === 'function') {
        ref(node)
      } else {
        (ref as MutableRefObject<T | null>).current = node
      }
    }
  }
}
