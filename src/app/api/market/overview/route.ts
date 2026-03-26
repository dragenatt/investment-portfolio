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

const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'AMD', name: 'AMD Inc.' },
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'BABA', name: 'Alibaba Group' },
  { symbol: 'PYPL', name: 'PayPal Holdings' },
  { symbol: 'INTC', name: 'Intel Corp.' },
]

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const [indexQuotes, sectorQuotes, popularQuotes] = await Promise.all([
    Promise.all(INDICES.map(async (idx) => {
      try {
        const q = await getQuote(idx.symbol)
        return {
          ...idx,
          price: q?.price ?? 0,
          change: q?.change ?? 0,
          changePct: q?.changePct ?? 0,
        }
      } catch {
        return { ...idx, price: 0, change: 0, changePct: 0 }
      }
    })),
    Promise.all(SECTORS.map(async (sec) => {
      try {
        const q = await getQuote(sec.symbol)
        return {
          ...sec,
          price: q?.price ?? 0,
          change: q?.change ?? 0,
          changePct: q?.changePct ?? 0,
        }
      } catch {
        return { ...sec, price: 0, change: 0, changePct: 0 }
      }
    })),
    Promise.all(POPULAR_SYMBOLS.map(async (stock) => {
      try {
        const q = await getQuote(stock.symbol)
        return {
          ...stock,
          price: q?.price ?? 0,
          change: q?.change ?? 0,
          changePct: q?.changePct ?? 0,
        }
      } catch {
        return { ...stock, price: 0, change: 0, changePct: 0 }
      }
    })),
  ])

  // Sort popular quotes by changePct to extract gainers and losers
  const sorted = [...popularQuotes].sort((a, b) => b.changePct - a.changePct)
  const gainers = sorted.filter(s => s.changePct > 0).slice(0, 5)
  const losers = sorted.filter(s => s.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 5)

  return success({
    indices: indexQuotes,
    sectors: sectorQuotes,
    popular: popularQuotes,
    gainers,
    losers,
  })
}
