'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'

export function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    if (!measurementId) return
    const handler = () => {
      setTimeout(() => setShouldLoad(true), 3000)
    }
    if (document.readyState === 'complete') {
      handler()
    } else {
      window.addEventListener('load', handler, { once: true })
      return () => window.removeEventListener('load', handler)
    }
  }, [measurementId])

  if (!measurementId || !shouldLoad) {
    return null
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="lazyOnload"
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  )
}