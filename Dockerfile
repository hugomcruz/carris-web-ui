# Use nginx for serving static files
FROM nginx:alpine

# Copy static files to nginx directory
COPY index.html /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/
COPY config.template.js /usr/share/nginx/html/
COPY lang /usr/share/nginx/html/lang/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy and set up entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 80

# Use entrypoint to inject environment variables
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
