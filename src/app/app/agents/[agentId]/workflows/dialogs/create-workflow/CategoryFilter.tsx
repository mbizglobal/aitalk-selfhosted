'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Category } from './types'

interface CategoryFilterProps {
  categories: Category[]
  selectedCategory: string
  onSelect: (category: string) => void
  allLabel: string
}

const ALL_CATEGORIES = '__all__'

export function CategoryFilter({
  categories,
  selectedCategory,
  onSelect,
  allLabel,
}: CategoryFilterProps) {
  const handleChange = (value: string) => {
    onSelect(value === ALL_CATEGORIES ? '' : value)
  }

  return (
    <Select value={selectedCategory || ALL_CATEGORIES} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CATEGORIES}>{allLabel}</SelectItem>
        {categories.map((category) => (
          <SelectItem key={category.code} value={category.code}>
            {category.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
