# SIIA · Sistemas Integrales Inmobiliarios y de Administración

Sitio web de SIIA (administración de condominios y fraccionamientos).

- **Staging:** https://staging.siia.casa
- **Stack:** [Astro](https://astro.build) (sitio estático) · AWS S3 + CloudFront + Route 53 (región `us-east-1`)
- **Portal de residentes:** https://staging.siia.casa/portal/ · **Administración:** https://staging.siia.casa/admin/ (solo grupo ADMIN)
- **Backend del portal:** AWS Amplify Gen 2 (app `siia-portal`, rama `staging`): Cognito, AppSync + DynamoDB, S3 y dos Lambdas

## Estructura

```
web/
  src/data/site.ts      Datos del sitio (contacto, servicios, textos). Los campos PENDIENTE requieren confirmación.
  src/data/logo.ts      Logotipo vectorizado (geometría medida del logotipo original)
  src/components/       Encabezado, pie, logotipo, botón de WhatsApp, etc.
  src/pages/            Inicio, Servicios, Nosotros, Cotizar, Contacto, Portal de residentes, legales, /portal, /admin
  src/app/              Apps React del portal (residentes y caseta) y del panel de administración
  amplify/              Backend Amplify Gen 2 (auth, data, storage, functions/admin-api, functions/portal-api)
  scripts/              Generación de íconos/imagen OG y despliegue
  infra/url-rewrite.js  CloudFront Function (URLs limpias → index.html)
```

## Desarrollo

```bash
cd web
npm install
npx ampx generate outputs --branch staging --app-id do7xm3gw1ryfq --out-dir .   # amplify_outputs.json (no se versiona)
npm run dev              # http://localhost:4321
npm run build
```

## Portal de residentes

- Todo servicio lo autoriza un administrador: cada condominio tiene sus **servicios habilitados** (finanzas y recibos,
  visitas y caseta, comunicados, encuestas, chat, incidentes, mantenimientos, amenidades, mascota segura).
- **Alta solo por la administración** (registro libre desactivado en Cognito): el administrador da de alta a cada
  residente (individual o masivo) y Cognito le envía por correo su usuario y contraseña temporal. Desde /admin se ve
  quién no ha hecho su primer ingreso y se puede **reenviar el acceso**.
- **Pagos:** el residente sube su comprobante del mes y recibe en su sesión «Comprobante de pago recibido»; al aprobarlo
  el administrador recibe «Tu pago fue aprobado» con su recibo foliado (o «no fue aprobado» con el motivo).
  Las notificaciones aparecen en la campana del portal y como aviso emergente.
- Roles (grupos de Cognito): `ADMIN` (panel /admin), `RESIDENTE` y `VIGILANTE` (modo caseta dentro de /portal).
- Residentes y vigilantes nunca leen tablas directamente: todo pasa por la Lambda `portal-api`, que valida aprobación,
  rol, condominio, unidad y servicio habilitado. El panel usa AppSync con autorización por grupo ADMIN y la Lambda
  `admin-api` (usuarios en Cognito, folios de recibos, cuotas, avisos).

## Despliegue a staging

Requiere AWS CLI con el perfil `Gared`:

```bash
cd web
npm run deploy:staging             # sitio (descarga amplify_outputs.json del backend)
BACKEND=1 npm run deploy:staging   # también despliega el backend de Amplify
```

Compila con `SITE_URL=https://staging.siia.casa`, sube a S3 (assets con caché de 1 año, HTML sin caché) e invalida CloudFront.
Staging no se indexa en buscadores (`robots.txt`, meta `noindex` y encabezado `X-Robots-Tag`); /portal y /admin nunca se indexan.

## Datos de demostración (staging)

```bash
cd web
DEMO_PASSWORD='…' npm run demo:crear   # borra la demo anterior y crea 2 condominios, 50 unidades, 50 residentes, 2 vigilantes y datos en todos los módulos
npm run demo:limpiar                   # borra todo lo de demostración (condominios demo-*, cuentas @demo.siia.casa, archivos demo-*)
```
