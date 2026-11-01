# SearXNG with our settings inside: Portainer needs no file on the server. Rebuilt at each deploy, which also brings
# upstream's fixes for search engines that changed.
FROM searxng/searxng:latest
# Outside /etc/searxng, which the image declares as a volume: a recreated container would keep the old file there.
COPY settings.yml /usr/local/searxng/open-agent/settings.yml
ENV SEARXNG_SETTINGS_PATH=/usr/local/searxng/open-agent/settings.yml
