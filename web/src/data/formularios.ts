// Dirección donde se envían los formularios del sitio (Cotizar y Contacto): la función pública siia-cotizaciones del
// backend de este ambiente (amplify_outputs.json). Si el ambiente aún no la tiene, los formularios abren WhatsApp o el correo.
import outputs from '../../amplify_outputs.json';

export const endpointFormularios: string | undefined = (outputs as { custom?: { cotizacionesUrl?: string } }).custom?.cotizacionesUrl;
