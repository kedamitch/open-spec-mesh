FROM python:3.13-alpine
WORKDIR /app
COPY . .
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health')"
ENTRYPOINT ["python", "app.py"]
