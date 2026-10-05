'use client'

import React from 'react'

interface Props {
  showBookedBadge?: boolean
  labels: {
    closed: string
    holiday: string
    range: string
    partial: string
    booked?: string
  }
}

export function LegendBar({ showBookedBadge, labels }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-400 px-1 pt-2">
      {showBookedBadge && labels.booked && <Item icon="🔵" label={labels.booked} />}
      <Item icon="🟡" label={labels.partial} />
      <Item icon="🚫" label={labels.closed} />
      <Item icon="🎉" label={labels.holiday} />
      <Item icon="✈️" label={labels.range} />
    </div>
  )
}

function Item({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}
