'use client'

import { describeMetadata, type ResultMetadata } from '@/lib/services/result-metadata'

/**
 * Where a result comes from (P2-10): the eight questions every important
 * financial figure answers about itself, behind one disclosure so they are
 * always one click away and never in the way.
 */
export function AuditTrail({ meta, className = '' }: { meta?: ResultMetadata | null; className?: string }) {
  if (!meta) return null
  const answers = describeMetadata(meta)
  return (
    <details className={`rounded-lg border border-border/70 px-3 py-2 text-xs ${className}`}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        ¿De dónde sale este resultado?
        <span className="ml-2 font-normal">
          {meta.model.id} {meta.model.version} · {meta.cache.served === 'cache' ? 'desde caché' : 'calculado ahora'}
        </span>
      </summary>
      <dl className="mt-2 space-y-1.5">
        {answers.map((item) => (
          <div key={item.question}>
            <dt className="font-medium text-foreground">{item.question}</dt>
            <dd className="text-muted-foreground">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
