#!/bin/sh
exec node --import /opt/rex/node_modules/tsx/dist/loader.mjs \
  /opt/rex/packages/pi-profiles/src/cli.ts "$@"
