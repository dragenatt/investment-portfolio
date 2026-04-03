export const apiFetcher = async (url: string) => {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  })

  // If the response was redirected (e.g., middleware sent us to /login),
  // the user's session has expired — throw a clear auth error so SWR
  // stops retrying (shouldRetryOnError checks for 401/Unauthorized).
  if (res.redirected) {
    throw new Error('Sesión expirada — Unauthorized (401)')
  }

  // Handle non-JSON responses (e.g., HTML error pages from Next.js)
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Unauthorized'
        : `Error del servidor (${res.status})`
    )
  }

  const json = await res.json()

  // API returns { data, error } — check error field first
  if (json.error) throw new Error(json.error)

  // Guard against unexpected HTTP errors
  if (!res.ok) throw new Error(`Error del servidor (${res.status})`)

  return json.data
}
