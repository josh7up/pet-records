# Pet Record System

NestJS + PostgreSQL backend for OCR pet records and a React + Vite frontend for owners to search records, inspect scans, and view weight trends.

## Tech stack

- Backend: NestJS (REST MVC), Prisma, PostgreSQL
- Frontend: React + TypeScript + Vite + Recharts
- OCR pipeline: queue stub + deterministic mock parser for vet invoice-style records
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

3. Run migrations:

```bash
npm run prisma:migrate
```

4. Seed with a realistic sample household/pet/document/visit/OCR/reminders/weight:

```bash
npm run prisma:seed
```

5. Start backend:

```bash
npm run start:dev
```

Backend API base URL: `http://localhost:3000/api`
Swagger UI: `http://localhost:3000/api/docs`

## OCR prerequisites

OCR runs through Google AI Studio:
- Set `GOOGLE_AI_STUDIO_API_KEY` in `.env`
- Images and PDFs are sent directly to Gemini for text extraction
- Default model is `gemini-2.0-flash` with automatic fallback models
- Uploads are blocked when a duplicate invoice number is detected for the same household

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

- `POST /api/households`
- `GET /api/households`
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
- `POST /api/ocr/:documentId/mock-parse`
- `GET /api/visits`
- `GET /api/records/search`
- `GET /api/weights/pets/:petId`

## Mock parser coverage

The parser in `src/ocr/mock-vet-record.parser.ts` extracts data shaped like your sample invoice:

- Clinic name/address/phone
- Printed date, visit date, account number, invoice number
- Line-item services and amounts
- Totals (charges/payments/balance)
- Pet name
- Multiple pets in one invoice (`For` rows, patient totals, and reminders per pet)
- Weight (value + unit)
- Reminder due dates and last-done dates

Seed OCR text is stored at `prisma/sample-record-ocr.txt`.

## Uploading new records

Single PDF or image:

```bash
curl -X POST "http://localhost:3000/api/documents/upload" \
  -F "file=@/absolute/path/to/record.pdf" \
  -F "householdId=<household-id>" \
  -F "petId=<pet-id>"
```

Multiple page images as one record (combined server-side into a PDF):

```bash
curl -X POST "http://localhost:3000/api/documents/upload-images" \
  -F "files=@/absolute/path/to/page-1.jpg" \
  -F "files=@/absolute/path/to/page-2.jpg" \
  -F "householdId=<household-id>" \
  -F "petId=<pet-id>"
```
