# site-explorer in a container: nothing to install on your machine except Docker.
#   docker build -t site-explorer .
#   docker run --rm -v "$PWD/out:/out" site-explorer https://example.com --out /out
# Chromium comes from Debian (not downloaded at run time). The container is the sandbox, so Chromium runs with --no-sandbox;
# explore only sites you trust, same as anywhere else.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium \
    SITE_EXPLORER_NO_SANDBOX=1 \
    SITE_EXPLORER_HOME=/opt/site-explorer-home \
    SITE_EXPLORER_NO_AUTO_INSTALL=1
WORKDIR /app
COPY package.json ./
COPY plugins/site-explorer/package.json plugins/site-explorer/LICENSE plugins/site-explorer/
COPY plugins/site-explorer/bin plugins/site-explorer/bin
COPY plugins/site-explorer/scripts plugins/site-explorer/scripts
COPY README.md README.en.md LICENSE ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force \
 && mkdir -p /out "$SITE_EXPLORER_HOME" && chown -R node:node /out "$SITE_EXPLORER_HOME"
USER node
WORKDIR /out
ENTRYPOINT ["node", "/app/plugins/site-explorer/bin/site-explorer.mjs"]
CMD ["--help"]
