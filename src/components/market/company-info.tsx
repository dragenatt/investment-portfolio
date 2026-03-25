'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, Users, Globe, MapPin } from 'lucide-react'
import { useState } from 'react'

type Props = {
  name: string
  description: string | null
  ceo: string | null
  employees: number | null
  hq: string | null
  website: string | null
  sector: string | null
  industry: string | null
}

export function CompanyInfo({ name, description, ceo, employees, hq, website, sector, industry }: Props) {
  const [expanded, setExpanded] = useState(false)
  const truncated = description && description.length > 200
    ? description.slice(0, 200) + '...'
    : description

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Sobre {name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {description && (
          <div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {expanded ? description : truncated}
            </p>
            {description.length > 200 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-primary font-medium mt-1 hover:underline"
              >
                {expanded ? 'Ver menos' : 'Ver mas'}
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {ceo && (
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">CEO</p>
                <p className="font-medium">{ceo}</p>
              </div>
            </div>
          )}
          {employees && (
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Empleados</p>
                <p className="font-medium">{employees.toLocaleString()}</p>
              </div>
            </div>
          )}
          {hq && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Pais</p>
                <p className="font-medium">{hq}</p>
              </div>
            </div>
          )}
          {website && (
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Web</p>
                <a href={website} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline truncate block max-w-[140px]">
                  {website.replace(/https?:\/\/(www\.)?/, '')}
                </a>
              </div>
            </div>
          )}
        </div>
        {(sector || industry) && (
          <div className="flex gap-2 flex-wrap">
            {sector && <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">{sector}</span>}
            {industry && <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">{industry}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
