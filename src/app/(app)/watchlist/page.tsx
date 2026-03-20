'use client'

import { useWatchlists } from '@/lib/hooks/use-watchlist'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonCard } from '@/components/shared/skeleton-card'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'

export default function WatchlistPage() {
  const { data: watchlists, isLoading } = useWatchlists()
  const { mutate } = useSWRConfig()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!newName) return
    setCreating(true)
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else { toast.success('Watchlist creada'); mutate('/api/watchlist') }
    setNewName('')
    setCreating(false)
  }

  if (isLoading) return <div className="space-y-4">{[1, 2].map(i => <SkeletonCard key={i} />)}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Watchlists</h1>
        <div className="flex gap-2">
          <Input className="w-48" placeholder="Nueva watchlist..." value={newName} onChange={e => setNewName(e.target.value)} />
          <Button size="sm" onClick={handleCreate} disabled={creating}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      {watchlists?.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No tienes watchlists. Crea una para empezar a seguir activos.</p>
      )}

      {watchlists?.map((wl: { id: string; name: string; watchlist_items: Array<{ id: string; symbol: string; asset_type: string }> }) => (
        <Card key={wl.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{wl.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {wl.watchlist_items?.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin activos. Busca en el mercado y agrega activos a esta watchlist.</p>
            ) : (
              <div className="space-y-2">
                {wl.watchlist_items?.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-1">
                    <span className="font-mono text-sm">{item.symbol}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={async () => {
                        await fetch(`/api/watchlist/${wl.id}/${encodeURIComponent(item.symbol)}`, { method: 'DELETE' })
                        mutate('/api/watchlist')
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
