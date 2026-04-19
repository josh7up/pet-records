# Pet Record System

NestJS + PostgreSQL backend for OCR pet records and a React + Vite frontend for owners to search records, inspect scans, and view weight trends.

## Tech stack

- Backend: NestJS (REST MVC), Prisma, PostgreSQL
- Frontend: React + TypeScript + Vite + Recharts
- OCR pipeline: queue stub + deterministic parser for vet invoice-style records
- Multi-pet parsing: one invoice document can produce multiple pet-specific visits

## Backend setup

1. Install dependencies in repo root:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env
```

If you use Docker Compose for PostgreSQL/pgAdmin, set these in `.env` too:

```bash
POSTGRES_DB=pet_records
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_db_password
PGADMIN_DEFAULT_EMAIL=admin@example.com
PGADMIN_DEFAULT_PASSWORD=your_pgadmin_password
```

Your Prisma connection string should match those values, for example:

```bash
DATABASE_URL="postgresql://your_db_user:your_db_password@localhost:5432/pet_records?schema=public"
```

Keep `DATABASE_URL` as a fully expanded value. Prisma expects a complete connection string, and plain `.env` files are not a reliable place to build it from `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` via variable interpolation.

3. Run migrations:

```bash
npm run prisma:migrate
```

4. Seed with a clean default dataset:

```bash
npm run prisma:seed
```

5. Start backend:

```bash
npm run start:dev
```

Backend API base URL: `http://localhost:3000/api`
Swagger UI: `http://localhost:3000/api/docs`

## Docker Compose

Use Docker Compose if you want PostgreSQL and pgAdmin running locally without installing them directly on your machine.

1. Copy the env file and fill in the database and pgAdmin credentials:

```bash
cp .env.example .env
```

2. Start the containers:

```bash
docker compose up -d
```

3. Confirm the database is healthy:

```bash
docker compose ps
```

4. Run Prisma migrations against the containerized database:

```bash
npm run prisma:migrate
```

5. Optional: seed the database:

```bash
npm run prisma:seed
```

Even when Docker Compose uses `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`, keep `DATABASE_URL` explicitly defined in `.env` for Prisma instead of trying to compose it from those variables inside the same file.

Services:
- PostgreSQL: `localhost:5432`
- pgAdmin: `http://localhost:5050`

pgAdmin login:
- Email: value of `PGADMIN_DEFAULT_EMAIL` in `.env`
- Password: value of `PGADMIN_DEFAULT_PASSWORD` in `.env`

Common Docker Compose commands:

```bash
docker compose down
docker compose down -v
```

`docker compose down` stops the containers and preserves database data. `docker compose down -v` also removes the named volumes, which resets the local database and pgAdmin state.

## OCR prerequisites

OCR runs through Google AI Studio:
- Set `GOOGLE_AI_STUDIO_API_KEY` in `.env`
- Images and PDFs are sent directly to Gemini for text extraction
- Default model is `gemini-2.0-flash` with automatic fallback models
- Uploads are blocked when a duplicate invoice number is detected

To enable verbose OCR debug logs in backend console:

```bash
OCR_DEBUG=true
```

Google AI Studio dependency:

```bash
npm install @google/generative-ai
```

If you get model-not-found errors (404), set model/fallbacks in `.env`:

```bash
GOOGLE_AI_STUDIO_MODEL=gemini-2.0-flash
GOOGLE_AI_STUDIO_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.0-flash-lite,gemini-1.5-flash-latest
```

If Google AI Studio is quota/rate-limited (429), requests fail until quota resets.

## Frontend setup

1. Install frontend dependencies:

```bash
npm --prefix frontend install
```

2. Optional API base override:

```bash
echo "VITE_API_BASE=http://localhost:3000/api" > frontend/.env.local
```

3. Start frontend:

```bash
npm run frontend:dev
```

Frontend URL: `http://localhost:5173`

## Implemented backend endpoints

- `POST /api/pets`
- `GET /api/pets`
- `GET /api/pets/:id`
- `POST /api/documents/upload` (multipart field: `file`)
- `POST /api/documents/upload-images` (multipart field: `files[]`, JPG/PNG pages merged into one PDF)
- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/documents/:id/file`
- `DELETE /api/documents/:id`
- `PATCH /api/documents/:id/fields`
- `GET /api/visits`
- `GET /api/records/search`
- `GET /api/weights/pets/:petId`

## Uploading new records

Single PDF or image:

```bash
curl -X POST "http://localhost:3000/api/documents/upload" \
  -F "file=@/absolute/path/to/record.pdf"
```

Multiple page images as one record (combined server-side into a PDF):

```bash
curl -X POST "http://localhost:3000/api/documents/upload-images" \
  -F "files=@/absolute/path/to/page-1.jpg" \
  -F "files=@/absolute/path/to/page-2.jpg"
```
