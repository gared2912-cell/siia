import type { APIRoute } from 'astro';
import { site as datos } from '../data/site';

const pages = ['/', '/servicios/', '/nosotros/', '/cotizar/', '/contacto/', '/portal-residentes/'];
if (datos.mostrarAviso) pages.push('/aviso-de-privacidad/');
if (datos.mostrarTerminos) pages.push('/terminos-y-condiciones/');

export const GET: APIRoute = ({ site }) => {
  const urls = pages.map((p) => `  <url><loc>${new URL(p, site)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
