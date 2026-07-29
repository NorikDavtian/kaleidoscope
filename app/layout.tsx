import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Refracted Descent — Kaleidoscope Studio',
  description:
    'A polycentral kaleidoscope. Feed it noise, a painted plate, or your own image.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Lora:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/studio/studio.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
