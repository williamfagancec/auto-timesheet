/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['database', 'shared', 'config'],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '@node-rs/argon2'],
  },
  // Generate standalone build for serverless deployment
  output: 'standalone',
}

module.exports = nextConfig
