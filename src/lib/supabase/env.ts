// The project URL and anon key, as every client that uses the anon key reads them.
//
// Vercel held both with a line break at the end, and Next inlines a NEXT_PUBLIC_
// value into the browser bundle exactly as stored. Most of the app never noticed:
// fetch trims header values, and supabase-js trims the URL. The Realtime socket
// is the exception — it carries the key in its URL, where the break went out as
// `%0A`, and the gateway refused every socket with 401 "Invalid API key". Live
// prices never streamed in production, and every open tab kept redialling.
//
// Neither value has meaningful whitespace at its ends, so trimming changes
// nothing that was right. The reads stay literal `process.env.NEXT_PUBLIC_…`
// expressions: that is the form Next inlines, and a dynamic lookup is not.

export function supabasePublicEnv(): { url: string; anonKey: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '',
  }
}
