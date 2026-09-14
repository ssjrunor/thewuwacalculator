/*
  Author: Runor Ewhro
  Description: Verifies contrast selection and background geometry used when
               sampling artwork beneath generated showcase text.
*/

import { describe, expect, it } from 'vitest'
import {
  chooseContrastInk,
  relativeLuminance,
  resolveBackgroundGeometry,
} from '../showcaseImageContrast.ts'

describe('showcase image contrast', () => {
  it('chooses light ink for a dark image region and dark ink for a light one', () => {
    expect(chooseContrastInk([relativeLuminance(8, 12, 18)]).ink).toBe('#f8fafc')
    expect(chooseContrastInk([relativeLuminance(245, 247, 250)]).ink).toBe('#101318')
  })

  it('uses the safer side of a mixed image region', () => {
    const mostlyDark = Array.from({ length: 9 }, () => relativeLuminance(12, 16, 22))
    mostlyDark.push(relativeLuminance(244, 246, 248))
    expect(chooseContrastInk(mostlyDark).ink).toBe('#f8fafc')
  })

  it('maps percentage background sizing and positioning like CSS', () => {
    expect(resolveBackgroundGeometry(480, 720, 1600, 900, '200%', '20% 50%')).toEqual({
      width: 960,
      height: 540,
      x: -96,
      y: 90,
    })
  })

  it('maps cover sizing without distorting the image', () => {
    expect(resolveBackgroundGeometry(480, 720, 1600, 900, 'cover', '50% 50%')).toEqual({
      width: 1280,
      height: 720,
      x: -400,
      y: 0,
    })
  })
})
