#!/bin/sh
set -e

# Default backend URL if not provided
BACKEND_URL=${BACKEND_URL:-"http://localhost:8000"}

echo "Configuring frontend with BACKEND_URL: $BACKEND_URL"

# Substitute environment variables in config template
envsubst '${BACKEND_URL}' < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js

echo "Configuration complete. Starting nginx..."

# Execute the CMD
exec "$@"
