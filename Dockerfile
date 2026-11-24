# syntax=docker/dockerfile:1
# Dashboard image: static files + nginx proxy to go2rtc. Non-root nginx on port 8080.
# The nginx config is rendered at start-up from nginx/default.conf.template (envsubst),
# so GO2RTC_UPSTREAM can differ per environment.
FROM nginxinc/nginx-unprivileged:1.27-alpine

ENV NGINX_PORT=8080 \
    GO2RTC_UPSTREAM=go2rtc:1984

# Drop the image's default server so only ours is rendered
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 101

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY dashboard/ /usr/share/nginx/html/

EXPOSE 8080
