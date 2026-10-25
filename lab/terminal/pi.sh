#!/bin/sh
exec /opt/rex/node_modules/.bin/pi \
  --offline --no-extensions --no-skills --no-prompt-templates \
  --no-themes --no-approve "$@"
