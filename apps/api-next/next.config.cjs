/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['database', 'shared', 'config'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
}

module.exports = nextConfig
