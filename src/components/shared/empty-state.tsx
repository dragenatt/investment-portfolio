import { type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

type Props = {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  const actionButton = action ? (
    <Button className="rounded-xl" size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  ) : null

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="p-4 rounded-2xl bg-primary/10 mb-4">
          <Icon className="h-8 w-8 text-primary" />
        </div>
        <h3 className="font-semibold text-lg mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
          {description}
        </p>
        {action?.href ? (
          <Link href={action.href}>{actionButton}</Link>
        ) : (
          actionButton
        )}
      </CardContent>
    </Card>
  )
}
