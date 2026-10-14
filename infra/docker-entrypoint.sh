#!/bin/sh
set -e

# Apply pending migrations, then start the app. Safe when several containers start at once:
# the runner takes a Postgres advisory lock, so the others wait and then skip everything.
# Set RUN_MIGRATIONS=false to skip, e.g. when migrations run as a separate release step:
#   docker run --rm -e RUN_MIGRATIONS=false <image> node dist/db/migrate.js
if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  node dist/db/migrate.js
fi

# exec, so node becomes PID 1 and receives SIGTERM directly (graceful shutdown).
exec "$@"