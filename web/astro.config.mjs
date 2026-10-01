// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// SITE_URL permite reutilizar el mismo código para staging y producción.
const site = process.env.SITE_URL ?? 'https://staging.siia.casa';

export default defineConfig({
  site,
  trailingSlash: 'ignore',
  // React solo se usa en las islas del portal de residentes (/portal) y del panel (/admin).
  integrations: [react()],
  build: {
    // Genera /servicios/index.html → la función de CloudFront reescribe /servicios a /servicios/index.html
    format: 'directory',
  },
  image: {
    responsiveStyles: true,
  },
});
