// @ts-check
import { defineConfig } from 'astro/config';

// SITE_URL permite reutilizar el mismo código para staging y producción.
const site = process.env.SITE_URL ?? 'https://staging.siia.casa';

export default defineConfig({
  site,
  trailingSlash: 'ignore',
  build: {
    // Genera /servicios/index.html → la función de CloudFront reescribe /servicios a /servicios/index.html
    format: 'directory',
  },
  image: {
    responsiveStyles: true,
  },
});
