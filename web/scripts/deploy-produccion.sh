#!/usr/bin/env bash
# Publica la plataforma en https://siia.casa (PRODUCCIÓN: datos reales de los clientes).
# Uso: CONFIRMAR=siia.casa npm run deploy:produccion
#   BACKEND=1 CONFIRMAR=siia.casa npm run deploy:produccion   → también despliega el backend de producción
# Cada cambio se prueba primero en staging (npm run deploy:staging). Requiere el perfil de AWS CLI "Gared".
set -euo pipefail

if [[ "${CONFIRMAR:-}" != "siia.casa" ]]; then
  echo "✘ Esto publica en PRODUCCIÓN (siia.casa). Para confirmar: CONFIRMAR=siia.casa npm run deploy:produccion"
  exit 1
fi

export AWS_PROFILE="${AWS_PROFILE:-Gared}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PAGER=""
export SIIA_AMBIENTE="produccion"
BUCKET="siia.casa"
DISTRIBUTION_ID="E33SVELZD2GHSE"
AMPLIFY_APP_ID="do7xm3gw1ryfq"
AMPLIFY_BRANCH="produccion"

cd "$(dirname "$0")/.."

# Al terminar (o si falla), amplify_outputs.json vuelve a apuntar a staging: así las pruebas y el
# desarrollo local nunca usan producción por accidente.
volver_a_staging() {
  echo "▶ amplify_outputs.json de vuelta a staging"
  npx ampx generate outputs --branch staging --app-id "$AMPLIFY_APP_ID" --out-dir . >/dev/null
}
trap volver_a_staging EXIT

if [[ "${BACKEND:-0}" == "1" ]]; then
  echo "▶ Backend Amplify ($AMPLIFY_BRANCH)"
  CI=true npx ampx pipeline-deploy --branch "$AMPLIFY_BRANCH" --app-id "$AMPLIFY_APP_ID"
fi

echo "▶ Configuración del backend de producción (amplify_outputs.json)"
npx ampx generate outputs --branch "$AMPLIFY_BRANCH" --app-id "$AMPLIFY_APP_ID" --out-dir .
node -e "const o=require('./amplify_outputs.json'); if (o.custom?.ambiente !== 'produccion') { console.error('✘ amplify_outputs.json no es de producción'); process.exit(1); }"

echo "▶ Build (SITE_URL=https://siia.casa)"
SITE_URL="https://siia.casa" npx astro build

echo "▶ Assets con hash (/_astro): caché de 1 año"
aws s3 sync dist/_astro "s3://$BUCKET/_astro" --delete \
  --cache-control "public, max-age=31536000, immutable"

echo "▶ HTML y demás archivos: siempre revalidar"
aws s3 sync dist "s3://$BUCKET" --delete --exclude "_astro/*" \
  --cache-control "public, max-age=0, must-revalidate"

echo "▶ Invalidando CloudFront"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.[Id,Status]' --output text

echo "✔ Publicado en https://siia.casa"
