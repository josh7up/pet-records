import type {
  DocumentRecord,
  Paginated,
  Pet,
  SearchVisit,
  UploadRecordPayload,
  WeightPoint,
} from '../types/api';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.text();
  if (!body) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(', ');
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Non-JSON body; use raw text.
  }
  return body;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }
  return response.json() as Promise<T>;
}

async function upload(path: string, formData: FormData) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Upload failed: ${response.status}`));
  }
  return response.json();
}

async function post(path: string, body?: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }
  return response.json();
}

async function del(path: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Request failed: ${response.status}`));
  }
  return response.json();
}

export const api = {
  baseUrl: API_BASE,
  pets: (query = '') => request<Paginated<Pet>>(`/pets${query ? `?${query}` : ''}`),
  searchVisits: (query = '') =>
    request<Paginated<SearchVisit>>(`/records/search${query ? `?${query}` : ''}`),
  documents: (query = '') =>
    request<Paginated<DocumentRecord>>(`/documents${query ? `?${query}` : ''}`),
  document: (documentId: string) => request<DocumentRecord>(`/documents/${documentId}`),
  weightSeries: (petId: string) =>
    request<{ petId: string; points: WeightPoint[]; stats: { count: number } }>(
      `/weights/pets/${petId}`,
    ),
  uploadDocument: (file: File, payload: UploadRecordPayload) => {
    const formData = new FormData();
    formData.append('file', file);
    if (payload.petId) formData.append('petId', payload.petId);
    if (payload.clinicId) formData.append('clinicId', payload.clinicId);
    if (payload.visitDate) formData.append('visitDate', payload.visitDate);
    return upload('/documents/upload', formData);
  },
  uploadDocumentImages: (files: File[], payload: UploadRecordPayload) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (payload.petId) formData.append('petId', payload.petId);
    if (payload.clinicId) formData.append('clinicId', payload.clinicId);
    if (payload.visitDate) formData.append('visitDate', payload.visitDate);
    return upload('/documents/upload-images', formData);
  },
  deleteDocument: (documentId: string) => del(`/documents/${documentId}`),
  reviewPets: (documentId: string, payload: unknown) =>
    post(`/ocr/${documentId}/review-pets`, payload),
};
