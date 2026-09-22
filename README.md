# SIIA · Sistemas Integrales Inmobiliarios y de Administración

Sitio web de SIIA (administración de condominios y fraccionamientos).

- **Staging:** https://staging.siia.casa
- **Stack:** [Astro](https://astro.build) (sitio estático) · AWS S3 + CloudFront + Route 53 (región `us-east-1`)

## Estructura

```
web/
  src/data/site.ts      Datos del sitio (contacto, servicios, textos). Los campos PENDIENTE requieren confirmación.
  src/data/logo.ts      Logotipo vectorizado (geometría medida del logotipo original)
  src/components/       Encabezado, pie, logotipo, botón de WhatsApp, etc.
  src/pages/            Inicio, Servicios, Nosotros, Cotizar, Contacto, Portal de residentes, legales
  scripts/              Generación de íconos/imagen OG y despliegue
  infra/url-rewrite.js  CloudFront Function (URLs limpias → index.html)
```

## Desarrollo

```bash
cd web
npm install
npm run dev              # http://localhost:4321
npm run build
```

## Despliegue a staging

Requiere AWS CLI con el perfil `Gared`:

```bash
cd web
npm run deploy:staging
```

Compila con `SITE_URL=https://staging.siia.casa`, sube a S3 (assets con caché de 1 año, HTML sin caché) e invalida CloudFront.
Staging no se indexa en buscadores (`robots.txt`, meta `noindex` y encabezado `X-Robots-Tag`).
