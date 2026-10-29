/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  async rewrites() {
    const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/certifications/:path*",
        destination: `${backendUrl}/certifications/:path*`,
      },
      {
        source: "/api/certifications",
        destination: `${backendUrl}/certifications`,
      },
    ];
  },
};
export default nextConfig;
