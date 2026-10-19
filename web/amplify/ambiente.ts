// Ambiente del backend: lo fija el script de despliegue (SIIA_AMBIENTE=staging | produccion) antes de `ampx`.
// Staging es el área de programación y pruebas; producción (siia.casa) es la plataforma de los clientes.
export const AMBIENTE: 'staging' | 'produccion' = process.env.SIIA_AMBIENTE === 'produccion' ? 'produccion' : 'staging';
export const ES_PRODUCCION = AMBIENTE === 'produccion';

export const SITIO = ES_PRODUCCION ? 'https://siia.casa' : 'https://staging.siia.casa';
export const PORTAL_URL = `${SITIO}/portal/`;

// Notificaciones push: cada ambiente tiene su par de llaves VAPID. La privada es un secreto de Amplify (SSM cifrado).
export const VAPID_PUBLICA = ES_PRODUCCION
  ? 'BJA3NRmwMlsSw2vUS50HF34aIwNfHsTFEDUQoxLiGgDskioeexI0nZKR8ZEyXgkIKinPszYcB4VYV8DGXW-Ezeo'
  : 'BBc-cq61OlRhNVETYGaLxzKz_aDe-C6UUH2-1NbRe_W1o5-Y_6Diw1_zVOETvEqf1nRuqjUV6a7j_zeyX8YVKnI';
export const SECRETO_VAPID = ES_PRODUCCION ? 'VAPID_PRIVATE_KEY_PRODUCCION' : 'VAPID_PRIVATE_KEY';
