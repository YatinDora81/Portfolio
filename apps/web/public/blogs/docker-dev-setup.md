# Docker for Dev — Stop Breaking Your Local Machine

Every new project: install this, configure that, wrong Node version, port conflict. Sound familiar?

## The Solution

Docker Compose for local development. One `docker-compose up` and everything works — database, Redis, backend, frontend.

## My Stack

```yaml
services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  app:
    build: .
    volumes: ["./src:/app/src"]
    ports: ["3000:3000"]
```

## Tips

- Use **volumes** for hot reload in development
- Use **multi-stage builds** for production images
- Keep dev and prod Dockerfiles separate
- Add a `Makefile` for common commands

Your teammates will thank you.
