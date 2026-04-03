'use client'

import { use } from 'react'
import { useState } from 'react'
import { usePublicProfile } from '@/lib/hooks/use-discover'
import { usePublicPortfolios } from '@/lib/hooks/use-discover'
import { useFollow } from '@/lib/hooks/use-social'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { ExternalLink, Heart, Users, Briefcase } from 'lucide-react'
import { PercentageChange } from '@/components/shared/percentage-change'

export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = use(params)
  const decodedUsername = decodeURIComponent(username)

  const { profile, isLoading: profileLoading, error: profileError } = usePublicProfile(decodedUsername)
  const { portfolios, isLoading: portfoliosLoading } = usePublicPortfolios('recent', 'desc', 'all', 1)
  const { isFollowing, toggle: toggleFollow, isLoading: followLoading } = useFollow(profile?.id || '')

  const filteredPortfolios = portfolios.filter((p) => p.userId === profile?.id)

  if (profileError) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Perfil no encontrado</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Profile Header Card */}
      <Card className="rounded-xl border-border">
        <CardContent className="pt-8">
          {profileLoading ? (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <Skeleton className="h-24 w-24 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-12 w-32" />
                </div>
              </div>
            </div>
          ) : profile ? (
            <>
              <div className="flex flex-col md:flex-row items-start md:items-start gap-6 mb-6">
                {/* Avatar */}
                <div className="relative">
                  <Avatar className="h-24 w-24 rounded-full">
                    {profile.avatar_url && (
                      <img
                        src={profile.avatar_url}
                        alt={profile.username}
                        className="h-full w-full object-cover rounded-full"
                      />
                    )}
                  </Avatar>
                </div>

                {/* Info */}
                <div className="flex-1">
                  <h1 className="text-3xl font-bold mb-1">{profile.username || profile.email}</h1>
                  <p className="text-sm text-muted-foreground mb-3">@{profile.username || profile.email.split('@')[0]}</p>

                  {profile.bio && <p className="text-base text-foreground mb-4">{profile.bio}</p>}

                  {/* Location and Website */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6 flex-wrap">
                    {/* Location would go here if available in profile */}
                    {/* Website would go here if available in profile */}
                    <span className="text-xs bg-secondary px-3 py-1 rounded-full text-foreground">
                      Miembro desde {new Date(profile.createdAt).getFullYear()}
                    </span>
                  </div>

                  {/* Follow Button */}
                  <Button
                    onClick={toggleFollow}
                    disabled={followLoading}
                    variant={isFollowing ? 'outline' : 'default'}
                    className="rounded-xl"
                  >
                    {isFollowing ? 'Siguiendo' : 'Seguir'}
                  </Button>
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-4 pt-6 border-t border-border">
                <div className="text-center">
                  <p className="text-xl font-bold">{profile.followerCount}</p>
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Users className="h-3 w-3" />
                    Seguidores
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold">{profile.followingCount}</p>
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Users className="h-3 w-3" />
                    Siguiendo
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold">{profile.portfolioCount}</p>
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Briefcase className="h-3 w-3" />
                    Portafolios
                  </p>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Portfolios Section */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Briefcase className="h-6 w-6" />
          Portafolios Públicos
        </h2>

        {portfoliosLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="rounded-xl border-border">
                <CardContent className="pt-6 space-y-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredPortfolios.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPortfolios.map((portfolio) => (
              <Link key={portfolio.id} href={`/portfolio/${portfolio.id}/public`}>
                <Card className="cursor-pointer hover:shadow-lg transition-all rounded-xl border-border h-full group">
                  <CardContent className="pt-6 space-y-4">
                    {/* Portfolio Name */}
                    <div>
                      <p className="font-bold text-base truncate">{portfolio.name}</p>
                      {portfolio.description && (
                        <p className="text-xs text-muted-foreground truncate mt-1">{portfolio.description}</p>
                      )}
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3 py-3 border-y border-border">
                      <div>
                        <PercentageChange value={portfolio.returnPercent} className="text-sm font-bold" />
                        <p className="text-xs text-muted-foreground">Retorno</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-emerald-500">-</p>
                        <p className="text-xs text-muted-foreground">Sharpe</p>
                      </div>
                    </div>

                    {/* Likes and CTA */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-sm">
                        <Heart className="h-4 w-4 text-red-500" />
                        <span className="text-muted-foreground">{portfolio.likeCount}</span>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="rounded-xl border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No hay portafolios públicos</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
