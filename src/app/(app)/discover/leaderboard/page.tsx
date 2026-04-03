'use client'

import { useState } from 'react'
import { useLeaderboard } from '@/lib/hooks/use-discover'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Award, Crown } from 'lucide-react'
import { PercentageChange } from '@/components/shared/percentage-change'

type Category = 'returns' | 'sharpe' | 'volatility' | 'consistency'
type Period = '1M' | '3M' | '1Y'

const getMedalColor = (rank: number) => {
  if (rank === 1) return 'text-yellow-500'
  if (rank === 2) return 'text-gray-400'
  if (rank === 3) return 'text-orange-500'
  return ''
}

const getMedalIcon = (rank: number) => {
  if (rank === 1) return <Crown className="h-5 w-5 text-yellow-500" />
  if (rank === 2) return <Award className="h-5 w-5 text-gray-400" />
  if (rank === 3) return <Award className="h-5 w-5 text-orange-500" />
  return null
}

export default function LeaderboardPage() {
  const [category, setCategory] = useState<Category>('returns')
  const [period, setPeriod] = useState<Period>('1Y')

  const categoryLabels: Record<Category, string> = {
    returns: 'Mayor Retorno',
    sharpe: 'Mejor Sharpe',
    volatility: 'Menor Volatilidad',
    consistency: 'Más Consistente',
  }

  const { rankings, isLoading, error } = useLeaderboard(category, period)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold font-serif">Leaderboard</h1>
          <p className="text-muted-foreground">
            Los mejores portafolios de InvestTracker
          </p>
        </div>

        {/* Period Selector */}
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-[140px] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1M">1 Mes</SelectItem>
            <SelectItem value="3M">3 Meses</SelectItem>
            <SelectItem value="1Y">1 Año</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={(v) => setCategory(v as Category)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="returns">{categoryLabels.returns}</TabsTrigger>
          <TabsTrigger value="sharpe">{categoryLabels.sharpe}</TabsTrigger>
          <TabsTrigger value="volatility">{categoryLabels.volatility}</TabsTrigger>
          <TabsTrigger value="consistency">{categoryLabels.consistency}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Leaderboard Table */}
      <Card className="rounded-xl border-border">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-muted-foreground">
              Error al cargar el leaderboard
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-sm font-semibold py-3 px-4">#</th>
                    <th className="text-left text-sm font-semibold py-3 px-4">Usuario</th>
                    <th className="text-left text-sm font-semibold py-3 px-4">Portafolio</th>
                    <th className="text-right text-sm font-semibold py-3 px-4">{categoryLabels[category]}</th>
                    <th className="text-right text-sm font-semibold py-3 px-4">Tendencia</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((ranking, idx) => (
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

                      {/* User Info */}
                      <td className="text-left py-4 px-4">
                        <Link href={`/profile/${ranking.username}`} className="flex items-center gap-3 hover:underline group">
                          <Avatar className="h-8 w-8 rounded-full flex-shrink-0">
                            {ranking.avatar_url && (
                              <img src={ranking.avatar_url} alt={ranking.username} className="h-full w-full object-cover rounded-full" />
                            )}
                          </Avatar>
                          <span className="font-medium group-hover:text-primary">{ranking.username}</span>
                        </Link>
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
                        {category === 'returns' ? (
                          <PercentageChange value={ranking.returnPercent} className="text-sm font-bold justify-end" />
                        ) : (
                          <p className="font-bold text-sm">-</p>
                        )}
                      </td>

                      {/* Trend Indicator */}
                      <td className="text-right py-4 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                          <span className="text-xs text-muted-foreground">Sube</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend for Top 3 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((position) => (
          <Card key={position} className="rounded-xl border-border bg-secondary/30">
            <CardContent className="pt-6 text-center">
              <div className="flex justify-center mb-2">
                {getMedalIcon(position) && <div className="text-3xl">{getMedalIcon(position)}</div>}
              </div>
              <p className="font-semibold">
                {position === 1
                  ? '1er Lugar'
                  : position === 2
                    ? '2do Lugar'
                    : '3er Lugar'}
              </p>
              <p className="text-xs text-muted-foreground">
                {position === 1
                  ? 'Mejor rendimiento'
                  : position === 2
                    ? 'Excelente desempeño'
                    : 'Gran logro'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
