import type { APIRoute } from 'astro';

// Staging (o cualquier dominio que no sea producción) bloquea a los buscadores.
export const GET: APIRoute = ({ site }) => {
  const isProduction = ['siia.casa', 'www.siia.casa'].includes(site?.hostname ?? '');
  const body = isProduction
    ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site)}\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
