import { NextResponse } from 'next/server'

export type ApiResponse<T = unknown> = {
  data: T | null
  error: string | null
  meta?: { total?: number; cursor?: string }
}

export function success<T>(data: T, meta?: ApiResponse['meta'], status = 200) {
  return NextResponse.json({ data, error: null, meta } satisfies ApiResponse<T>, { status })
}

export function error(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message } satisfies ApiResponse, { status })
}
