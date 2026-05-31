export function relationDistanceTone(distance: number | undefined): string {
  if (distance === undefined) return 'bg-white'
  if (distance <= 0) return 'bg-amber-50'
  if (distance === 1) return 'bg-emerald-50'
  if (distance === 2) return 'bg-sky-50'
  if (distance === 3) return 'bg-violet-50'
  return 'bg-slate-50'
}
