/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are ESM; let Next transpile them so imports resolve cleanly.
  transpilePackages: [
    "@coala/core",
    "@coala/providers",
    "@coala/inference",
    "@coala/export",
    "@coala/runtime",
  ],
  // Keep Prisma + bcrypt out of the bundler (native/runtime-only server deps).
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
