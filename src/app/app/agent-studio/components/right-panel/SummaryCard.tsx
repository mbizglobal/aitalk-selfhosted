'use client'

import React from 'react'

export const SummaryCard = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-[#151515] rounded-lg p-3 border border-[#222]">
    <p className="text-xs text-gray-500">{label}</p>
    <p className="text-lg font-semibold text-gray-100">{value}</p>
  </div>
)
