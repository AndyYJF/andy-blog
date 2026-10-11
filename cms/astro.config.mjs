import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: 'http://127.0.0.1:4322',
  server: { host: '127.0.0.1', port: 4322 },
  security: {
    allowedDomains: [{ hostname: '127.0.0.1', port: '4322', protocol: 'http' }],
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "worker-src 'none'",
      ],
    },
  },
  vite: {
    server: { host: '127.0.0.1', strictPort: true },
  },
});
