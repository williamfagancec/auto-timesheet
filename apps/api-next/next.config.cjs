/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['database', 'shared', 'config'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '@node-rs/argon2'],
  },
  // Disable static page generation for API routes
  output: 'standalone',
}

module.exports = nextConfig
