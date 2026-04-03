'use client'

import { useState, useCallback } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/i18n'

type Props = {
  id: string
  name: string
  description?: string
  onMutate: () => void
}

export function PortfolioActions({ id, name, description, onMutate }: Props) {
  const { t } = useTranslation()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newName, setNewName] = useState(name)
  const [newDesc, setNewDesc] = useState(description || '')
  const [saving, setSaving] = useState(false)

  const handleRename = useCallback(async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      toast.success(t.portfolio.portfolio_renamed)
      setRenameOpen(false)
      onMutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }, [id, newName, newDesc, t, onMutate])

  const handleDelete = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/portfolio/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      toast.success(t.portfolio.portfolio_deleted)
      setDeleteOpen(false)
      onMutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setSaving(false)
    }
  }, [id, t, onMutate])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7 shrink-0"
              onClick={(e) => e.preventDefault()}
            />
          }
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{t.portfolio.manage}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              setNewName(name)
              setNewDesc(description || '')
              setRenameOpen(true)
            }}
          >
            <Pencil className="h-4 w-4" />
            {t.portfolio.rename}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.preventDefault()
              setDeleteOpen(true)
            }}
          >
            <Trash2 className="h-4 w-4" />
            {t.portfolio.delete_portfolio}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.portfolio.rename_title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="portfolio-name">{t.portfolio.new_name}</Label>
              <Input
                id="portfolio-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename() }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portfolio-desc">{t.portfolio.new_description}</Label>
              <Input
                id="portfolio-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={handleRename} disabled={saving || !newName.trim()}>
              {saving ? t.portfolio.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.portfolio.delete_confirm_title}</DialogTitle>
            <DialogDescription>{t.portfolio.delete_confirm_desc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? t.portfolio.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
