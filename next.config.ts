import type { NextConfig } from "next";

// Standard build output — compatible with `next start -p ${PORT:-3000}` in any
// cloud container. (`output: "standalone"` was removed: it required manual
// static-file copies and a bun-based launcher, which broke cloud deployment.)
const nextConfig: NextConfig = {
  reactStrictMode: false,
};

export default nextConfig;
