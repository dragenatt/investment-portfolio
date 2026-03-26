import { AlertCircle, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type Props = {
  error: Error | string
  onRetry?: () => void
  compact?: boolean
}

function getMessage(error: Error | string): string {
  if (typeof error === 'string') return error
  return error.message || 'Ocurrio un error inesperado'
}

export function ErrorDisplay({ error, onRetry, compact }: Props) {
  const message = getMessage(error)

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm py-2">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        <span className="text-destructive">{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-primary hover:underline font-medium ml-1"
          >
            Reintentar
          </button>
        )}
      </div>
    )
  }

  return (
    <Card className="rounded-2xl border-destructive/30 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="p-4 rounded-2xl bg-destructive/10 mb-4">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="font-semibold text-lg mb-2">Algo salio mal</h3>
        <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
          {message}
        </p>
        {onRetry && (
          <Button
            className="rounded-xl gap-2"
            variant="outline"
            size="sm"
            onClick={onRetry}
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
