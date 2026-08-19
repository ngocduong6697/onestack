import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names, letting later Tailwind utilities win over
 * earlier ones instead of both landing in the class list.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
