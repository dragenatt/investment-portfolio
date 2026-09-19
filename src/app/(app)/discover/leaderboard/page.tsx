'use client'

import { useState } from 'react'
import { useLeaderboard } from '@/lib/hooks/use-discover'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { Award, Crown } from 'lucide-react'
import { PercentageChange } from '@/components/shared/percentage-change'
import type { LeaderboardCategory, Ranking } from '@/lib/services/discover'

const getMedalColor = (rank: number) => {
  // Text colours: 4.5:1 in both themes. The medal hue stays recognisable.
  if (rank === 1) return 'text-amber-700 dark:text-amber-400'
  if (rank === 2) return 'text-slate-600 dark:text-slate-300'
  if (rank === 3) return 'text-orange-700 dark:text-orange-400'
  return ''
}

const getMedalIcon = (rank: number) => {
  if (rank === 1) return <Crown className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
  if (rank === 2) return <Award className="h-5 w-5 text-slate-500 dark:text-slate-300" aria-hidden="true" />
  if (rank === 3) return <Award className="h-5 w-5 text-orange-600 dark:text-orange-400" aria-hidden="true" />
  return null
}

const CATEGORY_LABELS: Record<LeaderboardCategory, string> = {
  returns: 'Mayor Retorno',
  sharpe: 'Mejor Sharpe',
  volatility: 'Menor Volatilidad',
  consistency: 'Más Consistente',
}

/** What each category ranks by, said once under the table. */
const CATEGORY_NOTES: Record<LeaderboardCategory, string> = {
  returns: 'Rendimiento total desde que empezó cada portafolio.',
  sharpe: 'Rendimiento por unidad de riesgo. Requiere al menos cinco días de historial.',
  volatility: 'Volatilidad anualizada de los rendimientos diarios. Requiere al menos cinco días de historial.',
  consistency: 'Porcentaje de días con rendimiento positivo. Requiere al menos cinco días de historial.',
}

function MetricCell({ category, ranking }: { category: LeaderboardCategory; ranking: Ranking }) {
  if (category === 'returns') {
    return <PercentageChange value={ranking.returnPercent} className="text-sm font-bold justify-end" />
  }
  const value = category === 'sharpe' ? ranking.sharpeRatio : category === 'volatility' ? ranking.volatilityPct : ranking.winRatePct
  return (
    <p className="font-bold text-sm font-financial">
      {value === null ? '—' : category === 'sharpe' ? value.toFixed(2) : `${value.toFixed(1)}%`}
    </p>
  )
}

export default function LeaderboardPage() {
  const [category, setCategory] = useState<LeaderboardCategory>('returns')
  const { rankings, computedAt, isLoading, error } = useLeaderboard(category)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold font-serif">Leaderboard</h1>
        {/* One period only: the nightly snapshot measures each portfolio since it
            began. The old 1M/3M/1Y selector changed nothing it could measure. */}
        <p className="text-muted-foreground">
          Los portafolios públicos de InvestTracker, desde que empezó cada uno.
          {computedAt && ` Actualizado el ${new Date(computedAt).toLocaleDateString('es-MX', { dateStyle: 'long' })}.`}
        </p>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={(v) => setCategory(v as LeaderboardCategory)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          {(Object.keys(CATEGORY_LABELS) as LeaderboardCategory[]).map((key) => (
            <TabsTrigger key={key} value={key}>{CATEGORY_LABELS[key]}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Leaderboard Table */}
      <Card className="rounded-xl border-border">
        <CardContent className="pt-6 space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-muted-foreground">
              Error al cargar el leaderboard
            </div>
          ) : rankings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Todavía no hay portafolios públicos con datos para esta categoría. El ranking se actualiza cada noche.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="text-left text-sm font-semibold py-3 px-4">#</th>
                    <th scope="col" className="text-left text-sm font-semibold py-3 px-4">Usuario</th>
                    <th scope="col" className="text-left text-sm font-semibold py-3 px-4">Portafolio</th>
                    <th scope="col" className="text-right text-sm font-semibold py-3 px-4">{CATEGORY_LABELS[category]}</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((ranking, idx) => {
                    const name = ranking.displayName || ranking.username || 'Inversor'
                    const person = (
                      <>
                        <Avatar className="h-8 w-8 rounded-full flex-shrink-0">
                          {ranking.avatarUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- an avatar can be on any host; next/image needs each one allow-listed, and these are 32-64px thumbnails
                            <img src={ranking.avatarUrl} alt="" className="h-full w-full object-cover rounded-full" />
                          )}
                        </Avatar>
                        <span className="font-medium group-hover:text-primary">{name}</span>
                      </>
                    )
                    return (
                      <tr
                        key={ranking.portfolioId}
                        className={`border-b border-border last:border-0 transition-colors ${
                          idx < 3 ? 'bg-secondary/30' : ''
                        } hover:bg-secondary/20`}
                      >
                        {/* Rank with Medal */}
                        <td className="text-left py-4 px-4">
                          <div className="flex items-center gap-2">
                            {getMedalIcon(ranking.rank)}
                            <span className={`font-bold text-lg ${getMedalColor(ranking.rank)}`}>
                              #{ranking.rank}
                            </span>
                          </div>
                        </td>

                        {/* User Info: a profile link only when there is a username to link to */}
                        <td className="text-left py-4 px-4">
                          {ranking.username ? (
                            <Link href={`/profile/${ranking.username}`} className="flex items-center gap-3 hover:underline group">
                              {person}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-3">{person}</div>
                          )}
                        </td>

                        {/* Portfolio Name */}
                        <td className="text-left py-4 px-4">
                          <Link
                            href={`/portfolio/${ranking.portfolioId}/public`}
                            className="text-sm text-muted-foreground hover:text-primary truncate"
                          >
                            {ranking.portfolioName}
                          </Link>
                        </td>

                        {/* Metric Value */}
                        <td className="text-right py-4 px-4">
                          <MetricCell category={category} ranking={ranking} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{CATEGORY_NOTES[category]}</p>
        </CardContent>
      </Card>
    </div>
  )
}
