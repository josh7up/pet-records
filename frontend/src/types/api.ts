export type PetSpecies = 'DOG' | 'CAT' | 'BIRD' | 'RABBIT' | 'REPTILE' | 'OTHER';

export interface Household {
  id: string;
  name: string;
}

export interface Pet {
  id: string;
  householdId: string;
  name: string;
  species: PetSpecies;
  breed?: string | null;
  sex?: string | null;
}

export interface OcrPage {
  id: string;
  pageNumber: number;
  fullText: string;
}

export interface ExtractedField {
  id: string;
  fieldName: string;
  fieldValue: string;
  confidence?: number | null;
}

export interface VisitLineItem {
  id: string;
  description: string;
  totalPrice?: string | number | null;
  serviceDate?: string | null;
}

export interface Reminder {
  id: string;
  serviceName: string;
  dueDate?: string | null;
  lastDoneDate?: string | null;
}

export interface WeightPoint {
  id: string;
  measuredAt: string;
  weightValue: string | number;
  weightUnit: string;
}

export interface DocumentRecord {
  id: string;
  householdId: string;
  petId?: string | null;
  originalName: string;
  uploadedAt: string;
  ocrStatus: string;
  pages: OcrPage[];
  extractedFields: ExtractedField[];
  petCandidates: PetCandidate[];
  visits?: DocumentVisitRecord[];
}

export interface PetCandidate {
  id: string;
  detectedName: string;
  normalizedName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  matchedPetId?: string | null;
}

export interface SearchVisit {
  id: string;
  visitDate: string;
  invoiceNumber?: string | null;
  totalCharges?: string | number | null;
  totalPayments?: string | number | null;
  pet: Pet;
  lineItems: VisitLineItem[];
  reminders: Reminder[];
  document: DocumentRecord;
}

export interface DocumentVisitRecord {
  id: string;
  visitDate: string;
  invoiceNumber?: string | null;
  totalCharges?: string | number | null;
  totalPayments?: string | number | null;
  pet: Pet;
  lineItems: VisitLineItem[];
  reminders: Reminder[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UploadRecordPayload {
  householdId: string;
  petId?: string;
  clinicId?: string;
  visitDate?: string;
}
