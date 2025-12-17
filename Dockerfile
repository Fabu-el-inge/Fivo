# Multi-stage build for Fivo Backend
# Stage 1: Build C++ Core
FROM node:18 AS builder

# Install C++ build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy project files
COPY CMakeLists.txt .
COPY core ./core
COPY tests ./tests
COPY demos ./demos

# Build C++ core
RUN mkdir -p build && \
    cd build && \
    cmake .. && \
    make

# Verify binary was created
RUN ls -la /app/build/bin/ && \
    test -f /app/build/bin/fivo_demo && \
    echo "Binary compiled successfully"

# Stage 2: Production Runtime
FROM node:18-slim

WORKDIR /app

# Copy all compiled binaries and libraries from builder stage
COPY --from=builder /app/build/bin /app/build/bin
COPY --from=builder /app/build/lib /app/build/lib
RUN chmod +x /app/build/bin/fivo_demo

# Set library path for shared libraries
ENV LD_LIBRARY_PATH=/app/build/lib

# Copy BFF application
COPY bff/package*.json ./bff/
WORKDIR /app/bff

# Install production dependencies only
RUN npm ci --only=production

# Copy server code
COPY bff/server.js .

# Expose port (Railway will assign dynamically via $PORT)
EXPOSE 3001

# Health check uses PORT environment variable
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const port = process.env.PORT || 3001; require('http').get('http://localhost:' + port + '/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "server.js"]
