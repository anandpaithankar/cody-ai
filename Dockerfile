# Multi-stage: Backend
FROM python:3.10-slim AS backend
WORKDIR /app/server
COPY server/ .
RUN pip install -r requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# Frontend
FROM node:18 AS frontend
WORKDIR /app/client
COPY client/ .
RUN npm ci && npm run build
CMD ["npm", "run", "dev"]
