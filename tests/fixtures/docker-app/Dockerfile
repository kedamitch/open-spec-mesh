FROM node:24-alpine
WORKDIR /app
COPY . .
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "--input-type=module", "--eval", "await import('./app.js')"]
