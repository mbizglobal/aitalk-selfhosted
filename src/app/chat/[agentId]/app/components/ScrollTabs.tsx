'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface TabItem {
  key: string
  label: string
  title?: string
  active: boolean
  onClick: () => void
}

const tabCls = (on: boolean) => `shrink-0 px-3 py-2 text-sm rounded-t-md border-b-2 whitespace-nowrap ${on ? 'border-[#E07B53] text-white' : 'border-transparent text-gray-400 hover:text-white'}`

export function ScrollTabs({ items, prevLabel, nextLabel }: { items: TabItem[]; prevLabel: string; nextLabel: string }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const activeKey = items.find((x) => x.active)?.key

  const update = useCallback(() => {
    const el = rowRef.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }, [])

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
      update()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel) }
  }, [update, items.length])

  const labelsKey = items.map((x) => `${x.key}\u0001${x.label}`).join('\u0002')
  useEffect(() => { update() }, [labelsKey, update])

  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeKey ?? '')}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    update()
  }, [activeKey, update])

  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !rowRef.current) return
    drag.current = { x: e.clientX, left: rowRef.current.scrollLeft, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = rowRef.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 5) return
    if (!d.moved) { d.moved = true; el.setPointerCapture(e.pointerId) }
    el.scrollLeft = d.left - dx
    update()
  }
  const endDrag = (e: React.PointerEvent) => {
    const el = rowRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (drag.current?.moved) {
      const stop = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
    }
    drag.current = null
  }

  const step = (dir: -1 | 1) => {
    const el = rowRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7) })
    update()
  }

  const arrow = 'absolute top-0 bottom-0 z-10 flex items-center px-1 text-gray-300 hover:text-white'
  return (
    <div className="relative border-b border-[#2A2A2A] min-w-0">
      <div ref={rowRef} onScroll={update} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        className={`flex gap-1 overflow-x-auto px-3 pt-2 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${edges.left || edges.right ? 'cursor-grab active:cursor-grabbing' : ''}`}>
        {items.map((x) => (
          <button key={x.key} data-tab={x.key} onClick={x.onClick} className={tabCls(x.active)} title={x.title}>{x.label}</button>
        ))}
      </div>
      {edges.left && (
        <button onClick={() => step(-1)} aria-label={prevLabel} className={`${arrow} left-0 pr-6 bg-gradient-to-r from-[#1E1E1E] via-[#1E1E1E]/90 to-transparent`}>
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      {edges.right && (
        <button onClick={() => step(1)} aria-label={nextLabel} className={`${arrow} right-0 pl-6 bg-gradient-to-l from-[#1E1E1E] via-[#1E1E1E]/90 to-transparent`}>
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
