import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  }
};

export default nextConfig;
