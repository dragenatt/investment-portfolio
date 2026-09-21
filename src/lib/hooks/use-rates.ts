import useSWR from 'swr'
import { apiFetcher } from '@/lib/api/fetcher'
import { FX_RATE_TTL_MS } from '@/lib/utils/fx-pairs'

/**
 * The exchange rates every conversion on screen uses, asked for again every
 * FX_RATE_TTL_MS (it was five minutes, against an hour on the server).
 *
 * No fallbackData: with a hard-coded 17.5 here the provider's documented
 * last-resort rates (use-currency.tsx) never applied, and nothing said the
 * figure on screen came from a constant.
 */
export function useRates() {
  return useSWR<Record<string, number>>('/api/rates', apiFetcher, {
    refreshInterval: FX_RATE_TTL_MS,
  })
}
