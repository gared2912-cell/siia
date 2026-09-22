#!/usr/bin/env bash
# Publica el sitio en https://staging.siia.casa
# Uso: npm run deploy:staging   (requiere el perfil de AWS CLI "Gared")
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-Gared}"
export AWS_PAGER=""
BUCKET="staging.siia.casa"
DISTRIBUTION_ID="E2ZVIOIQADE0ZZ"

cd "$(dirname "$0")/.."

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
