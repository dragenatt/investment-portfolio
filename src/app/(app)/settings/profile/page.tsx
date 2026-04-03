'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import useSWR from 'swr'
import { Avatar } from '@/components/ui/avatar'

const fetcher = (url: string) =>
  fetch(url)
    .then((r) => r.json())
    .then((r) => {
      if (r.error) throw new Error(r.error)
      return r.data
    })

export default function SocialProfileSettingsPage() {
  const { data: profile, isLoading, mutate } = useSWR('/api/user/profile', fetcher)

  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [location, setLocation] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)

  // Initialize form from profile
  useEffect(() => {
    if (profile) {
      setUsername(profile.username || '')
      setBio(profile.bio || '')
      setLocation(profile.location || '')
      setWebsite(profile.website || '')
    }
  }, [profile])

  const bioCharCount = bio.length
  const bioMaxChars = 300

  const handleSave = async () => {
    if (!username.trim()) {
      toast.error('El usuario es requerido')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          bio,
          location,
          website,
        }),
      })

      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }

      toast.success('Perfil actualizado')
      mutate()
    } catch (err) {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-lg">
        <h1 className="text-3xl font-bold">Perfil Social</h1>
        <div className="space-y-4">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Perfil Social</h1>
        <p className="text-muted-foreground">
          Personaliza cómo otros te ven en InvestTracker
        </p>
      </div>

      {/* Avatar Preview */}
      {profile && (
        <Card className="rounded-xl border-border">
          <CardHeader>
            <CardTitle className="text-lg">Avatar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 rounded-full">
                {profile.avatar_url && (
                  <img
                    src={profile.avatar_url}
                    alt={profile.username || profile.email}
                    className="h-full w-full object-cover rounded-full"
                  />
                )}
              </Avatar>
              <div>
                <p className="text-sm text-muted-foreground">
                  Tu avatar está sincronizado con tu foto de perfil de Gravatar
                </p>
                {profile.email && (
                  <p className="text-xs text-muted-foreground mt-1">{profile.email}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profile Form */}
      <Card className="rounded-xl border-border">
        <CardHeader>
          <CardTitle className="text-lg">Información del Perfil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Username */}
          <div className="space-y-2">
            <Label htmlFor="username">Usuario</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">@</span>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.-]/g, ''))}
                placeholder="mi_usuario"
                className="rounded-xl flex-1"
                maxLength={30}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Solo letras, números, guiones y guiones bajos
            </p>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <Label htmlFor="bio">Biografía</Label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, bioMaxChars))}
              placeholder="Cuéntanos sobre ti y tu filosofía de inversión..."
              className="w-full min-h-[120px] px-3 py-2 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 resize-none"
              maxLength={bioMaxChars}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Máximo {bioMaxChars} caracteres
              </p>
              <p className={`text-xs font-medium ${bioCharCount > bioMaxChars * 0.9 ? 'text-orange-500' : 'text-muted-foreground'}`}>
                {bioCharCount}/{bioMaxChars}
              </p>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Ubicación</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ciudad, País"
              className="rounded-xl"
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground">
              Donde se encuentran tus principales operaciones
            </p>
          </div>

          {/* Website */}
          <div className="space-y-2">
            <Label htmlFor="website">Sitio Web</Label>
            <Input
              id="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://ejemplo.com"
              className="rounded-xl"
              type="url"
              maxLength={255}
            />
            <p className="text-xs text-muted-foreground">
              Enlace opcional a tu blog, newsletter o sitio web personal
            </p>
          </div>

          {/* Save Button */}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-xl mt-6"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </CardContent>
      </Card>

      {/* Profile URL Preview */}
      {username && (
        <Card className="rounded-xl border-border bg-secondary/30">
          <CardHeader>
            <CardTitle className="text-sm">Tu URL de Perfil</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 p-3 bg-background rounded-lg border border-border">
              <code className="text-sm text-muted-foreground flex-1 truncate">
                {typeof window !== 'undefined' ? `${window.location.origin}/profile/${username}` : 'investtracker.local/profile/'}
              </code>
              <Button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    navigator.clipboard.writeText(`${window.location.origin}/profile/${username}`)
                    toast.success('URL copiada')
                  }
                }}
                size="sm"
                variant="ghost"
                className="rounded-lg flex-shrink-0"
              >
                Copiar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Privacy Note */}
      <Card className="rounded-xl border-border bg-blue-500/5 border-blue-500/20">
        <CardContent className="pt-6">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Nota:</span>{' '}
            Este perfil es completamente público. Cualquiera puede encontrarte por tu usuario.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
