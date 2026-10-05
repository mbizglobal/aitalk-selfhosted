import type { NextConfig } from "next";

const getDevOrigins = () => {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (!nextAuthUrl) return [];

  try {
    const url = new URL(nextAuthUrl);
    return [url.hostname];
  } catch {
    return [];
  }
};

const nextConfig: NextConfig = {
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's3.eu-west-1.amazonaws.com',
        pathname: '/aitalk.ch/**',
      },
      {
        protocol: 'https',
        hostname: 's3.eu-west-1.amazonaws.com',
        pathname: '/aitalk.ch-user-icons/**',
      },
    ],
    unoptimized: true
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: getDevOrigins(),
  serverExternalPackages: ['pdfjs-dist'],
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    proxyClientMaxBodySize: '25mb',
    optimizeCss: true,
  },
  async headers() {
    return [
      {
        source: '/chat/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *",
          },
        ],
      },
      {
        source: '/chat/:agentId/app',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      {
        source: '/chat/:agentId/app/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      {
        source: '/book/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        source: '/embed.min.js',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
        ],
      },
      {
        source: '/fonts/google/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/blog/en/un-retour-aprs-20-ans-de-pdg-dveloppeur-un-nouveau-dpart-avec-un-chatbot-ia',
        destination: '/blog/fr/un-retour-aprs-20-ans-de-pdg-dveloppeur-un-nouveau-dpart-avec-un-chatbot-ia',
        permanent: true,
      },
      {
        source: '/blog/en/aitalkch-rejoint-microsoft-for-startups-pour-dvelopper-les-agents-vocaux-ia-travers-leurope',
        destination: '/blog/en/aitalkch-joins-microsoft-for-startups-to-scale-ai-voice-agents-across-europe',
        permanent: true,
      },
      {
        source: '/blog/en/cmo-construir-un-chatgpt-con-tus-propios-datos-una-introduccin-a-rag-generacin-aumentada-por-recuperacin',
        destination: '/blog/es/cmo-construir-un-chatgpt-con-tus-propios-datos-una-introduccin-a-rag-generacin-aumentada-por-recuperacin',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
