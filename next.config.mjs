/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  onDemandEntries: {
    maxInactiveAge: 1000,
    pagesBufferLength: 1,
  },
}

export default nextConfig
