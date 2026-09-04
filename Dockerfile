FROM node:20-bookworm-slim AS assets

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tailwind.config.js ./
COPY src ./src
RUN npm run build:css

FROM node:20-bookworm-slim

ARG TERRAFORM_VERSION=1.9.5

# System deps: ansible (+python3), ssh client for provisioning, curl/unzip to install terraform,
# gosu to drop from root to the unprivileged user after fixing bind-mount ownership at startup
RUN apt-get update && apt-get install -y --no-install-recommends \
    ansible \
    openssh-client \
    curl \
    unzip \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/terraform.zip \
    "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip" \
    && unzip /tmp/terraform.zip -d /usr/local/bin \
    && rm /tmp/terraform.zip \
    && terraform -version

# Non-root user to run the app
RUN useradd --create-home --shell /bin/bash forge
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --chown=forge:forge . .
COPY --from=assets --chown=forge:forge /app/src/public/css/tailwind.css /app/src/public/css/tailwind.css
RUN chmod +x entrypoint.sh && chown -R forge:forge /home/forge

ENV DATA_DIR=/app/data
EXPOSE 3000

# Stays root so the entrypoint can chown the (possibly host bind-mounted) data
# dir regardless of its ownership on the host, then drops to the forge user.
ENTRYPOINT ["/app/entrypoint.sh"]
