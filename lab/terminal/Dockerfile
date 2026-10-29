FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

ENV NODE_ENV=production \
    PATH=/usr/local/bin:/opt/rex/node_modules/.bin:$PATH \
    HOME=/state \
    PI_CODING_AGENT_DIR=/state/pi \
    PI_CODING_AGENT_SESSION_DIR=/state/pi/sessions \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0
WORKDIR /opt/rex/lab/terminal
COPY --from=profile-core . /opt/rex/packages/profiles/
COPY --from=pi-profiles . /opt/rex/packages/pi-profiles/
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund --cache /tmp/rex-npm \
    && rm -rf /tmp/rex-npm \
    && ln -s lab/terminal/node_modules /opt/rex/node_modules \
    && mkdir -p /workspace /state /run/rex /profiles /proposals \
    && chown node:node /workspace /state /run/rex /proposals
COPY transport.ts configure.ts runtime.ts verify.ts provision.ts connector.ts /opt/rex/
COPY fixture-extension.mjs /opt/rex/operator-extensions/fixture.mjs
COPY fixture-mcp.mjs /opt/rex/operator-mcp/fixture.mjs
COPY fixture-mcp.mjs /opt/rex/operator-mcp/discovery.mjs
COPY fixture-mcp.mjs /opt/rex/operator-mcp/uncertain.mjs
COPY fixture-remote.mjs /opt/rex/fixture-remote.mjs
COPY profiles/ /profiles/
COPY pi.sh /usr/local/bin/pi
RUN chmod 755 /usr/local/bin/pi
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["node", "--import", "/opt/rex/node_modules/tsx/dist/loader.mjs", "/opt/rex/runtime.ts"]
