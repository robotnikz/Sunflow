#!/bin/sh
set -eu

# Ensure data dir exists (volume or bind mount)
mkdir -p /app/data

# If running as root, try to ensure the runtime user can write.
# - Named volumes are typically initialized from the image (permissions preserved)
# - Bind mounts may require chown/chmod; on some platforms/filesystems this can fail
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data 2>/dev/null || true
  chmod -R u+rwX /app/data 2>/dev/null || true

  # Run the app as the non-root node user
  if command -v gosu >/dev/null 2>&1; then
    exec gosu node node server.js
  fi

  # Fallback (older images): use `su` if available.
  exec su node -s /bin/sh -c "exec node server.js"
fi

# Already non-root
exec node server.js
