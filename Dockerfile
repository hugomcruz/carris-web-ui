# Use nginx for serving static files
FROM nginx:alpine

# Copy static files to nginx directory
COPY index.html /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/
COPY lang /usr/share/nginx/html/lang/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
