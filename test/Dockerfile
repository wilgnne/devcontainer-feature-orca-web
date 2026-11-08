ARG BASE_IMAGE=mcr.microsoft.com/devcontainers/base:ubuntu26.04
FROM ${BASE_IMAGE}
USER root
RUN groupadd -g 2201 orca-developers \
    && useradd -m -u 1201 -g orca-developers -s /bin/bash node \
    && useradd -m -u 1202 -g orca-developers -s /bin/bash developer
COPY src/orca-web /tmp/orca-web-feature
ARG REMOTE_USER
RUN cd /tmp/orca-web-feature && _REMOTE_USER="$REMOTE_USER" bash install.sh \
    && rm -f /usr/bin/sudo /bin/sudo \
    && rm -rf /tmp/orca-web-feature
COPY test/user.sh /usr/local/lib/orca-web/test-user.sh
