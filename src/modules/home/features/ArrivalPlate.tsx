/*
  Author: Runor Ewhro
  description: coordinates arrival data, artwork fallback, one-time
               activation, pointer-derived motion, shared active selection,
               and opening held arrivals on modulation.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import { useAppStore } from '@/application/state'
import { useNavX } from '@/shared/navigation/useNavX'
import { SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { TbMathFunction } from 'react-icons/tb'
import { useMenuContributions } from '@/application/context-menu/AppContextMenu'
import type { MenuContribution } from '@/application/context-menu/menuContributions'
import { useTstStr } from '@/shared/util/toastStore'
import type { ArrivedResonator, Arrivals } from '@/modules/home/model/arrivals'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { SpinePortrait } from '@/shared/spine/SpinePortrait'

type Side = 'l' | 'r'
type ArrivalContext = { who: ArrivedResonator, side: Side }

interface ArrivalPlateProps {
  arrivals: Arrivals
  /** whether this section is the current rested home view. */
  reading: boolean
  /** reports the active resonator to sibling arrival metadata. */
  onLit?: (id: string | null) => void
  /** disables entrance and pointer motion. */
  still: boolean
}

// remounting by artwork key resets fallback state when release data changes.
function Figure({ who, className, animated }: { who: ArrivedResonator, className: string, animated: boolean }) {
  const [src, setSrc] = useState(who.artFallback ?? who.art)

  return (
    <span className={className} aria-hidden="true">
      <span className="hm-half__stage">
        <SpinePortrait
          resId={who.id}
          animated={animated}
          playing={animated}
          spineClassName="hm-half__spine"
          placement={getEvaluationSpinePlacement(who.id)}
          fallback={
            <img
              className="hm-half__fallback"
              src={src}
              alt=""
              onError={() => {
                if (src !== who.art) setSrc(who.art)
              }}
            />
          }
        />
      </span>
    </span>
  )
}

function Half({ who, animated }: { who: ArrivedResonator, animated: boolean }) {
  return (
    <>
      <Figure who={who} className="hm-half__art" animated={animated} key={who.art} />
      <span className="hm-half__bloom" aria-hidden="true" />
      <span className="hm-half__scrim" aria-hidden="true" />

      <span className="hm-half__txt">
        <span className="hm-half__el">
          {[who.attributeName, who.weaponName].filter(Boolean).join(' · ')}
        </span>
        <span className="hm-half__name">{who.name}</span>
        <span className="hm-half__says">
          {who.tags.length > 0
            ? who.tags.join(', ')
            : `A new ${who.attributeName || ''} resonator.`}
        </span>
        <span className="hm-chips">
          {who.signature ? <span className="hm-chip">{who.signature.name}</span> : null}
          <span className="hm-chip hm-chip--el">{who.attributeName}</span>
        </span>
        <span className={`hm-half__held${who.held ? '' : ' is-waiting'}`}>
          <i aria-hidden="true" />
          {who.held ? 'In the app' : 'Not in yet'}
        </span>
      </span>
    </>
  )
}

export function ArrivalPlate({ arrivals, reading, onLit, still }: ArrivalPlateProps) {
  const showToast = useTstStr((state) => state.show)
  const swapResonator = useAppStore((state) => state.swRes)
  const navigate = useNavX()
  const plate = useRef<HTMLDivElement | null>(null)
  const [lit, setLit] = useState<Side | null>(null)
  const [swept, setSwept] = useState(() => still)

  const pair = arrivals.resonators.slice(0, 2)
  const [left, right] = pair

  /* run activation once when the rested section first becomes active. two
     animation frames ensure the initial state commits before activation. */
  useEffect(() => {
    if (!reading || swept) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSwept(true))
    })
    return () => {
      cancelAnimationFrame(first)
      if (second) cancelAnimationFrame(second)
    }
  }, [reading, swept])

  // normalize pointer coordinates to [-1, 1] css variables unless motion is disabled.
  const track = (event: RPointerEvent<HTMLDivElement>) => {
    const node = plate.current
    if (!node || still) return
    const box = node.getBoundingClientRect()
    node.style.setProperty('--hm-px', ((event.clientX - box.left) / box.width * 2 - 1).toFixed(3))
    node.style.setProperty('--hm-py', ((event.clientY - box.top) / box.height * 2 - 1).toFixed(3))
  }

  const light = useCallback((side: Side | null, id: string | null) => {
    setLit(side)
    onLit?.(id)
  }, [onLit])

  const rest = () => {
    light(null, null)
    const node = plate.current
    if (!node) return
    node.style.setProperty('--hm-px', '0')
    node.style.setProperty('--hm-py', '0')
  }

  const open = useCallback((who: ArrivedResonator) => {
    swapResonator(who.id)
    navigate(SIMULATION_ROUTES.modulation)
  }, [navigate, swapResonator])

  const contributions = useMemo<MenuContribution<ArrivalContext>[]>(() => [{
    id: 'home-arrival-highlight',
    group: '1_primary',
    build: ({ who, side }) => [
      ...(who.held ? [{
        id: `home-arrival-build:${who.id}`,
        label: `Build ${who.name}`,
        icon: <TbMathFunction size="1em" />,
        onSelect: () => open(who),
      }] : []),
      {
        id: `home-arrival-highlight:${who.id}`,
        label: 'Highlight',
        onSelect: () => light(side, who.id),
      },
    ],
  }, {
    id: 'home-arrival-copy-name',
    group: '2_copy',
    build: ({ who }) => [{
      id: `home-arrival-copy-name:${who.id}`,
      label: 'Copy name',
      onSelect: () => {
        if (!navigator.clipboard?.writeText) {
          showToast({ content: 'Could not copy name', variant: 'error' })
          return
        }
        void navigator.clipboard.writeText(who.name).then(
          () => showToast({ content: 'Name copied', variant: 'success' }),
          () => showToast({ content: 'Could not copy name', variant: 'error' }),
        )
      },
    }],
  }], [light, open, showToast])
  useMenuContributions('home.arrival', contributions)

  if (!left) return null

  return (
    <div
      className={`hm-split${right ? '' : ' hm-split--single'}${swept ? '' : ' is-shut'}`}
      ref={plate}
      data-lit={lit ?? undefined}
      style={{ '--el-l': left.colour, '--el-r': right?.colour } as CSSProperties}
      onPointerMove={track}
      onPointerLeave={rest}
    >
      {pair.map((who, index) => {
        const side: Side = index === 0 ? 'l' : 'r'
        return (
          <ContextTrigger
            asChild
            ariaLabel={`${who.name} actions`}
            location="home.arrival"
            context={{ who, side }}
            key={who.id}
          >
          <button
            type="button" className="hm-half"
            data-side={side}
            style={{ '--el': who.colour } as CSSProperties}
            aria-label={`${who.held ? `Build ${who.name}` : who.name}, ${who.attributeName} ${who.weaponName}, ${who.held ? 'in the app' : 'not in yet'}`}
            onPointerEnter={() => light(side, who.id)}
            onFocus={() => light(side, who.id)}
            onBlur={rest}
            onClick={() => {
              if (who.held) open(who)
              else if (lit === side) rest()
              else light(side, who.id)
            }}
          >
            <Half who={who} animated={reading && !still} />
          </button>
          </ContextTrigger>
        )
      })}

      {right ? <span className="hm-seam" aria-hidden="true" /> : null}
    </div>
  )
}
