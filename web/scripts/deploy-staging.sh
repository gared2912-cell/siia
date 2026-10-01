#!/usr/bin/env bash
# Publica el sitio en https://staging.siia.casa
# Uso: npm run deploy:staging   (requiere el perfil de AWS CLI "Gared")
#   BACKEND=1 npm run deploy:staging   → también despliega el backend de Amplify (Cognito, AppSync, DynamoDB, S3, Lambdas)
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-Gared}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PAGER=""
BUCKET="staging.siia.casa"
DISTRIBUTION_ID="E2ZVIOIQADE0ZZ"
AMPLIFY_APP_ID="do7xm3gw1ryfq"
AMPLIFY_BRANCH="staging"

cd "$(dirname "$0")/.."

if [[ "${BACKEND:-0}" == "1" ]]; then
  echo "▶ Backend Amplify ($AMPLIFY_BRANCH)"
  CI=true npx ampx pipeline-deploy --branch "$AMPLIFY_BRANCH" --app-id "$AMPLIFY_APP_ID"
fi

echo "▶ Configuración del backend (amplify_outputs.json)"
npx ampx generate outputs --branch "$AMPLIFY_BRANCH" --app-id "$AMPLIFY_APP_ID" --out-dir .

echo "▶ Build (SITE_URL=https://staging.siia.casa)"
SITE_URL="https://staging.siia.casa" npx astro build

echo "▶ Assets con hash (/_astro): caché de 1 año"
aws s3 sync dist/_astro "s3://$BUCKET/_astro" --delete \
  --cache-control "public, max-age=31536000, immutable"

echo "▶ HTML y demás archivos: siempre revalidar"
aws s3 sync dist "s3://$BUCKET" --delete --exclude "_astro/*" \
  --cache-control "public, max-age=0, must-revalidate"

echo "▶ Invalidando CloudFront"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.[Id,Status]' --output text

echo "✔ Publicado en https://staging.siia.casa"
