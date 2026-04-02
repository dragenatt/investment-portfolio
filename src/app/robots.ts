import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/portfolio', '/settings'],
    },
    sitemap: 'https://project-tri0w.vercel.app/sitemap.xml',
  }
}
