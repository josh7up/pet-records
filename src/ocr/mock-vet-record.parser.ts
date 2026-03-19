export interface ParsedLineItem {
  serviceDate?: Date;
  description: string;
  totalPrice?: number;
}

export interface ParsedReminder {
  dueDate?: Date;
  serviceName: string;
  lastDoneDate?: Date;
}

export interface ParsedPetSection {
  petName: string;
  totalCharges?: number;
  weightValue?: number;
  weightUnit?: string;
  lineItems: ParsedLineItem[];
  reminders: ParsedReminder[];
}

export interface ParsedVetRecord {
  clinicName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  printedAt?: Date;
  visitDate?: Date;
  accountNumber?: string;
  invoiceNumber?: string;
  petName?: string;
  totalCharges?: number;
  totalPayments?: number;
  balance?: number;
  weightValue?: number;
  weightUnit?: string;
  lineItems: ParsedLineItem[];
  reminders: ParsedReminder[];
  petSections: ParsedPetSection[];
  extractedFields: { fieldName: string; fieldValue: string; confidence?: number }[];
}
