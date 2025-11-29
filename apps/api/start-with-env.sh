#!/bin/bash

# Load .env file from project root
ENV_FILE="../../.env"

if [ -f "$ENV_FILE" ]; then
    echo "Loading environment from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
fi

# Start the server
exec pnpm exec tsx watch src/index.ts
