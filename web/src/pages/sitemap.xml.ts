import type { APIRoute } from 'astro';

const pages = ['/', '/servicios/', '/nosotros/', '/cotizar/', '/contacto/', '/portal-residentes/', '/aviso-de-privacidad/', '/terminos-y-condiciones/'];

export const GET: APIRoute = ({ site }) => {
  const urls = pages.map((p) => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
