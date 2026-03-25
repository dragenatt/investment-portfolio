import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { getQuote } from '@/lib/services/market'

const INDICES = [
  { symbol: '^GSPC', name: 'S&P 500', region: 'US' },
  { symbol: '^DJI', name: 'Dow Jones', region: 'US' },
  { symbol: '^IXIC', name: 'NASDAQ', region: 'US' },
  { symbol: '^MXX', name: 'IPC México', region: 'MX' },
  { symbol: '^FTSE', name: 'FTSE 100', region: 'UK' },
  { symbol: '^N225', name: 'Nikkei 225', region: 'JP' },
]

const SECTORS = [
  { symbol: 'XLK', name: 'Tecnología' },
  { symbol: 'XLF', name: 'Financiero' },
  { symbol: 'XLV', name: 'Salud' },
  { symbol: 'XLE', name: 'Energía' },
  { symbol: 'XLY', name: 'Consumo Disc.' },
  { symbol: 'XLI', name: 'Industrial' },
  { symbol: 'XLP', name: 'Consumo Básico' },
  { symbol: 'XLU', name: 'Servicios Pub.' },
  { symbol: 'XLRE', name: 'Inmobiliario' },
  { symbol: 'XLB', name: 'Materiales' },
  { symbol: 'XLC', name: 'Comunicaciones' },
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const [indexQuotes, sectorQuotes] = await Promise.all([
    Promise.all(INDICES.map(async (idx) => {
      const q = await getQuote(idx.symbol)
      return {
        ...idx,
        price: q?.price ?? 0,
        change: q?.change ?? 0,
        changePct: q?.changePct ?? 0,
      }
    })),
    Promise.all(SECTORS.map(async (sec) => {
      const q = await getQuote(sec.symbol)
      return {
        ...sec,
        price: q?.price ?? 0,
        change: q?.change ?? 0,
        changePct: q?.changePct ?? 0,
      }
    })),
  ])

  return success({ indices: indexQuotes, sectors: sectorQuotes })
}
