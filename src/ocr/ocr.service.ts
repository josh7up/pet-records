import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentStatus,
  PetCandidateStatus,
  PetSpecies,
  Prisma,
} from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  ReviewAction,
  ReviewPetCandidatesDto,
} from '../documents/dto/review-pet-candidates.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ParsedPetSection, ParsedVetRecord } from './record.parser.types';
import type { UploadDocumentDto } from '../documents/dto/upload-document.dto';

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<any>;

class DuplicateInvoiceError extends Error {
  constructor(invoiceNumber: string) {
    super(
      `Duplicate invoice number detected: ${invoiceNumber}. This invoice already exists for the selected household.`,
    );
    this.name = 'DuplicateInvoiceError';
  }
}

function normalizePetName(value: string) {
  return value
    .replace(/[^A-Za-z' -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractHighConfidencePetNamesFromRawText(_: string) {
  return [];
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private isOcrDebugEnabled() {
    return this.config.get<string>('OCR_DEBUG', 'false').toLowerCase() === 'true';
  }

  private getGoogleAiStudioKey() {
    return this.config.get<string>('GOOGLE_AI_STUDIO_API_KEY');
  }

  private getGoogleAiModel() {
    return this.config.get<string>('GOOGLE_AI_STUDIO_MODEL', 'gemini-2.0-flash');
  }

  private getGoogleAiFallbackModels() {
    const configured = this.config.get<string>('GOOGLE_AI_STUDIO_FALLBACK_MODELS');
    if (!configured?.trim()) {
      return ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest'];
    }
    return configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private ocrDebug(message: string, meta?: unknown) {
    if (!this.isOcrDebugEnabled()) {
      return;
    }
    if (meta !== undefined) {
      this.logger.log(`${message} ${JSON.stringify(meta)}`);
      return;
    }
    this.logger.log(message);
  }

  private normalizeInvoiceNumber(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private isLikelyInvoiceToken(value: string) {
    const trimmed = value.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (trimmed.length < 4 || trimmed.length > 40) {
      return false;
    }
    return /\d/.test(trimmed);
  }

  private extractInvoiceCandidatesFromText(text: string) {
    const candidates = new Set<string>();
    const patterns = [
      /(?:invoice|inv)\s*(?:number|no|num|#)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,39})/gi,
      /\binv[-_\s]?([0-9]{4,20})\b/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null = null;
      while ((match = pattern.exec(text)) !== null) {
        const raw = match[1]?.trim();
        if (!raw || !this.isLikelyInvoiceToken(raw)) {
          continue;
        }
        candidates.add(raw);
      }
    }

    return Array.from(candidates);
  }

  private extractInvoiceCandidatesFromFilename(filename: string) {
    const cleaned = filename.replace(/\.[^.]+$/, ' ');
    return this.extractInvoiceCandidatesFromText(cleaned);
  }

  private async collectInvoiceCandidatesForUpload(files: Express.Multer.File[]) {
    const candidates = new Set<string>();

    for (const file of files) {
      for (const candidate of this.extractInvoiceCandidatesFromFilename(file.originalname || '')) {
        candidates.add(candidate);
      }
      for (const candidate of this.extractInvoiceCandidatesFromFilename(file.filename || '')) {
        candidates.add(candidate);
      }

      if (file.mimetype === 'application/pdf') {
        try {
          const pdfBytes = await readFile(file.path);
          const asText = pdfBytes.toString('latin1').replace(/\u0000/g, ' ');
          for (const candidate of this.extractInvoiceCandidatesFromText(asText)) {
            candidates.add(candidate);
          }
        } catch (error) {
          this.ocrDebug('Failed to inspect PDF for invoice precheck', {
            path: file.path,
            message: String((error as Error)?.message || error),
          });
        }
      }
    }

    return Array.from(candidates);
  }

  private async findDuplicateInvoiceForHousehold(
    householdId: string,
    invoiceCandidates: string[],
    excludeDocumentId?: string,
  ) {
    if (!invoiceCandidates.length) {
      return undefined;
    }

    const existingVisits = await this.prisma.visit.findMany({
      where: {
        invoiceNumber: { not: null },
        document: {
          householdId,
          id: excludeDocumentId ? { not: excludeDocumentId } : undefined,
        },
      },
      select: { invoiceNumber: true },
    });

    const normalizedExisting = new Set(
      existingVisits
        .map((visit) => visit.invoiceNumber)
        .filter((invoiceNumber): invoiceNumber is string => Boolean(invoiceNumber))
        .map((invoiceNumber) => this.normalizeInvoiceNumber(invoiceNumber))
        .filter(Boolean),
    );

    for (const candidate of invoiceCandidates) {
      const normalizedCandidate = this.normalizeInvoiceNumber(candidate);
      if (!normalizedCandidate) {
        continue;
      }
      if (normalizedExisting.has(normalizedCandidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private async resolveHouseholdId(householdId?: string) {
    if (householdId) {
      return householdId;
    }
    const existing = await this.prisma.household.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }
    const created = await this.prisma.household.create({
      data: { name: 'Default Household' },
      select: { id: true },
    });
    return created.id;
  }

  async assertNoDuplicateInvoiceForUpload(
    dto: Pick<UploadDocumentDto, 'householdId'>,
    files: Express.Multer.File[],
  ) {
    const householdId = await this.resolveHouseholdId(dto.householdId);
    const invoiceCandidates = await this.collectInvoiceCandidatesForUpload(files);
    const duplicate = await this.findDuplicateInvoiceForHousehold(
      householdId,
      invoiceCandidates,
    );
    if (duplicate) {
      throw new ConflictException(
        `Duplicate invoice number detected before OCR: ${duplicate}. This invoice already exists for the selected household.`,
      );
    }
  }

  private inferMimeTypeFromPath(path: string) {
    const extension = extname(path).toLowerCase();
    if (extension === '.png') {
      return 'image/png';
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      return 'image/jpeg';
    }
    if (extension === '.webp') {
      return 'image/webp';
    }
    if (extension === '.pdf') {
      return 'application/pdf';
    }
    return 'application/octet-stream';
  }

  private async runGoogleStudioExtract(
    paths: string[],
    mimeTypeOverrides?: string[],
    responseMimeType?: string,
  ) {
    const apiKey = this.getGoogleAiStudioKey();
    if (!apiKey) {
      throw new Error(
        'GOOGLE_AI_STUDIO_API_KEY is not configured. Add it to your .env file.',
      );
    }

    this.ocrDebug('Running Google AI Studio extract', {
      fileCount: paths.length,
      model: this.getGoogleAiModel(),
    });

    const module = await dynamicImport('@google/generative-ai');
    const GoogleGenerativeAI = module?.GoogleGenerativeAI;
    if (!GoogleGenerativeAI) {
      throw new Error(
        '@google/generative-ai is not installed. Run `npm install @google/generative-ai`.',
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const structuredPrompt =
      'You are a veterinary record parser that converts records to JSON. ' +
      'Output JSON data in the following format, replacing the example data with the appropriate values:\n\n' +
      '{\n' +
      '  "vetClinic": "[Golden Corner]",\n' +
      '  "visitDate": "[YYYY-MM-DD]",\n' +
      '  "accountNumber": "[12345]",\n' +
      '  "invoiceNumber": "[123456]",\n' +
      '  "petsExamined": [\n' +
      '    {\n' +
      '      "petName": "[Fluffy]",\n' +
      '      "petAgeMonths": 48,\n' +
      '      "petWeight": 15.1,\n' +
      '      "services": [\n' +
      '        {\n' +
      '          "description": "[Rabies Recomb]",\n' +
      '          "price": 123.50\n' +
      '        }\n' +
      '      ],\n' +
      '      "totalPrice": 234.00,\n' +
      '      "reminders": [\n' +
      '        {\n' +
      '          "reminderDate": "[YYYY-MM-DD]",\n' +
      '          "lastDone": "[YYYY-MM-DD]",\n' +
      '          "description": ""\n' +
      '        }\n' +
      '      ]\n' +
      '    }\n' +
      '  ],\n' +
      '  "totalCharges": 335.72,\n' +
      '  "paymentType": "[VISA]",\n' +
      '  "paymentAmount": 335.72\n' +
      '}\n\n' +
      'Return only JSON. If a value is missing, use null or an empty array. Do not include commentary.';

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: structuredPrompt },
    ];

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const fileBuffer = await readFile(path);
      const mimeType = mimeTypeOverrides?.[index] || this.inferMimeTypeFromPath(path);
      parts.push({
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType,
        },
      });
      this.ocrDebug('Google AI Studio input attached', {
        path,
        mimeType,
        bytes: fileBuffer.byteLength,
      });
    }

    const configuredModel = this.getGoogleAiModel();
    const candidates = Array.from(
      new Set([configuredModel, ...this.getGoogleAiFallbackModels()]),
    );
    const failures: string[] = [];

    for (const modelName of candidates) {
      try {
        this.ocrDebug('Google AI Studio calling model', { model: modelName });
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts }],
          generationConfig: responseMimeType ? { responseMimeType } : undefined,
        });
        const text = result?.response?.text?.() || '';
        this.ocrDebug('Google AI Studio extract finished', {
          model: modelName,
          chars: text.length,
          preview: text.slice(0, 500),
        });
        return text;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const message = String((error as Error)?.message || error);
        failures.push(`${modelName}: ${message}`);
        this.ocrDebug('Google AI Studio model failed', {
          model: modelName,
          status,
          message,
        });
        if (status !== 404 && status !== 400 && status !== 429) {
          throw error;
        }
      }
    }

    throw new Error(
      `No available Google AI Studio model succeeded. Tried: ${candidates.join(', ')}. Failures: ${failures.join(
        ' | ',
      )}`,
    );
  }

  private parseStructuredJson(text: string) {
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found in structured OCR response.');
    }
    const sliced = trimmed.slice(start, end + 1);
    return JSON.parse(sliced) as {
      vetClinic?: string;
      visitDate?: string;
      accountNumber?: string;
      invoiceNumber?: string;
      petsExamined?: Array<{
        petName?: string;
        petAgeMonths?: number;
        petWeight?: number;
        services?: Array<{ description?: string; price?: number }>;
        totalPrice?: number;
        reminders?: Array<{ reminderDate?: string; lastDone?: string; description?: string }>;
      }>;
      totalCharges?: number;
      paymentType?: string;
      paymentAmount?: number;
    };
  }

  private parseIsoDate(value?: string) {
    if (!value) return undefined;
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return undefined;
    const [, yyyy, mm, dd] = match;
    const year = Number(yyyy);
    const month = Number(mm);
    const day = Number(dd);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return undefined;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return undefined;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return undefined;
    }
    return date;
  }

  private mapStructuredToParsed(structured: ReturnType<OcrService['parseStructuredJson']>): ParsedVetRecord {
    const petSections: ParsedPetSection[] = (structured.petsExamined || [])
      .filter((pet) => pet.petName)
      .map((pet) => ({
        petName: String(pet.petName || '').trim(),
        totalCharges: typeof pet.totalPrice === 'number' ? pet.totalPrice : undefined,
        weightValue: typeof pet.petWeight === 'number' ? pet.petWeight : undefined,
        weightUnit: pet.petWeight ? 'lbs' : undefined,
        lineItems: (pet.services || [])
          .filter((service) => service.description)
          .map((service) => ({
            description: String(service.description || '').trim(),
            totalPrice:
              typeof service.price === 'number' && Number.isFinite(service.price)
                ? service.price
                : undefined,
          })),
        reminders: (pet.reminders || [])
          .filter((reminder) => reminder.description)
          .map((reminder) => ({
            serviceName: String(reminder.description || '').trim(),
            dueDate: this.parseIsoDate(reminder.reminderDate),
            lastDoneDate: this.parseIsoDate(reminder.lastDone || undefined),
          })),
      }));

    const allLineItems = petSections.flatMap((section) => section.lineItems);
    const allReminders = petSections.flatMap((section) => section.reminders);
    const firstSection = petSections[0];

    const extractedFields: ParsedVetRecord['extractedFields'] = [
      structured.visitDate
        ? { fieldName: 'visit_date', fieldValue: structured.visitDate, confidence: 0.95 }
        : undefined,
      structured.invoiceNumber
        ? {
            fieldName: 'invoice_number',
            fieldValue: String(structured.invoiceNumber),
            confidence: 0.94,
          }
        : undefined,
      structured.accountNumber
        ? {
            fieldName: 'account_number',
            fieldValue: String(structured.accountNumber),
            confidence: 0.92,
          }
        : undefined,
      typeof structured.totalCharges === 'number'
        ? {
            fieldName: 'receipt_total_price',
            fieldValue: String(structured.totalCharges),
            confidence: 0.86,
          }
        : undefined,
      typeof structured.paymentAmount === 'number'
        ? {
            fieldName: 'payment_amount',
            fieldValue: String(structured.paymentAmount),
            confidence: 0.82,
          }
        : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));

    return {
      clinicName: structured.vetClinic?.trim() || undefined,
      visitDate: this.parseIsoDate(structured.visitDate),
      accountNumber: structured.accountNumber?.trim() || undefined,
      invoiceNumber: structured.invoiceNumber?.trim() || undefined,
      petName: firstSection?.petName,
      totalCharges:
        typeof structured.totalCharges === 'number' ? structured.totalCharges : firstSection?.totalCharges,
      totalPayments:
        typeof structured.paymentAmount === 'number' ? structured.paymentAmount : undefined,
      balance: undefined,
      weightValue: firstSection?.weightValue,
      weightUnit: firstSection?.weightUnit,
      lineItems: allLineItems,
      reminders: allReminders,
      petSections,
      extractedFields,
      printedAt: undefined,
    };
  }

  async enqueueDocument(documentId: string) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { ocrStatus: DocumentStatus.OCR_IN_PROGRESS },
    });

    return {
      documentId,
      status: 'queued',
      provider: 'configure-textract-or-document-ai',
      message: 'Document uploaded. OCR provider queue is not configured for PDFs yet.',
    };
  }

  async processUploadedImages(
    documentId: string,
    imagePaths: string[],
    mimeTypeOverrides?: string[],
  ) {
    if (!imagePaths.length) {
      return this.enqueueDocument(documentId);
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { ocrStatus: DocumentStatus.OCR_IN_PROGRESS },
    });

    const pageTexts: string[] = [];
    try {
      this.ocrDebug('Starting OCR processing for images', {
        documentId,
        imageCount: imagePaths.length,
      });

      const structuredText = await this.runGoogleStudioExtract(
        imagePaths,
        mimeTypeOverrides,
        'application/json',
      );
      pageTexts.push(structuredText);
    } catch (error) {
      this.logger.error('OCR image processing failed', error as Error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: DocumentStatus.FAILED },
      });
      return {
        documentId,
        status: 'failed',
        provider: 'google-ai-studio',
        message: `OCR failed using Google AI Studio while reading uploaded image pages. ${String(
          (error as Error)?.message || error,
        )}`,
      };
    }

    const combinedText = pageTexts.join('\n\n');
    this.ocrDebug('Combined OCR text', {
      documentId,
      chars: combinedText.length,
      preview: combinedText.slice(0, 500),
    });
    try {
      const structured = this.parseStructuredJson(combinedText);
      const parsed = this.mapStructuredToParsed(structured);
      await this.parseAndPersist(documentId, combinedText, pageTexts, parsed);
    } catch (error) {
      this.logger.error('OCR parse/persist failed', error as Error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: DocumentStatus.FAILED },
      });
      if (error instanceof DuplicateInvoiceError) {
        return {
          documentId,
          status: 'failed',
          provider: 'google-ai-studio',
          message: error.message,
        };
      }
      return {
        documentId,
        status: 'failed',
        provider: 'google-ai-studio',
        message: `OCR completed but required fields were missing or invalid. ${String(
          (error as Error)?.message || error,
        )}`,
      };
    }

    const updated = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { ocrStatus: true },
    });

    if (updated?.ocrStatus === DocumentStatus.NEEDS_REVIEW) {
      return {
        documentId,
        status: 'needs_review',
        provider: 'google-ai-studio',
        message: 'OCR completed. Review detected pet names before creating new pets.',
      };
    }

    return {
      documentId,
      status: 'parsed',
      provider: 'google-ai-studio',
      message: 'Document upload completed successfully',
    };
  }

  async processUploadedDocument(documentId: string) {
    this.ocrDebug('Processing uploaded document', { documentId });
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { filePath: true, mimeType: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }
    this.ocrDebug('Loaded uploaded document metadata', {
      documentId,
      mimeType: document.mimeType,
      filePath: document.filePath,
    });

    if (document.mimeType === 'image/png' || document.mimeType === 'image/jpeg') {
      return this.processUploadedImages(documentId, [document.filePath]);
    }

    if (document.mimeType === 'application/pdf') {
      return this.processUploadedImages(documentId, [document.filePath], ['application/pdf']);
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { ocrStatus: DocumentStatus.FAILED },
    });

    return {
      documentId,
      status: 'failed',
      provider: 'configure-textract-or-document-ai',
      message:
        'Unsupported file type for OCR extraction. Upload PDF/JPG/PNG.',
    };
  }

  async reviewPetCandidates(documentId: string, dto: ReviewPetCandidatesDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        pages: { orderBy: { pageNumber: 'asc' } },
        petCandidates: { where: { status: PetCandidateStatus.PENDING } },
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const pendingById = new Map(document.petCandidates.map((candidate) => [candidate.id, candidate]));

    for (const decision of dto.decisions) {
      const candidate = pendingById.get(decision.candidateId);
      if (!candidate) {
        continue;
      }

      if (decision.action === ReviewAction.REJECT) {
        await this.prisma.documentPetCandidate.update({
          where: { id: candidate.id },
          data: { status: PetCandidateStatus.REJECTED, matchedPetId: null },
        });
        continue;
      }

      let petId: string;
      if (decision.action === ReviewAction.LINK) {
        if (!decision.petId) {
          continue;
        }
        const linkedPet = await this.prisma.pet.findFirst({
          where: { id: decision.petId, householdId: document.householdId },
          select: { id: true },
        });
        if (!linkedPet) {
          continue;
        }
        petId = linkedPet.id;
      } else {
        const created = await this.prisma.pet.create({
          data: {
            householdId: document.householdId,
            name: (decision.petName || candidate.detectedName).trim(),
            species: PetSpecies.OTHER,
          },
          select: { id: true },
        });
        petId = created.id;
      }

      await this.prisma.documentPetCandidate.update({
        where: { id: candidate.id },
        data: { status: PetCandidateStatus.APPROVED, matchedPetId: petId },
      });
    }

    const rawText = document.pages.map((page) => page.fullText).join('\n\n');
    await this.parseAndPersist(
      documentId,
      rawText,
      document.pages.map((page) => page.fullText),
    );

    return this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        petCandidates: true,
        visits: { include: { pet: true } },
      },
    });
  }

  private async parseAndPersist(
    documentId: string,
    rawText: string,
    pageTexts: string[] = [rawText],
    parsedOverride?: ParsedVetRecord,
  ) {
    this.ocrDebug('parseAndPersist start', {
      documentId,
      textChars: rawText.length,
      pageCount: pageTexts.length,
    });
    const parsed =
      parsedOverride ?? this.mapStructuredToParsed(this.parseStructuredJson(rawText));
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        pet: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (parsed.invoiceNumber) {
      const duplicate = await this.findDuplicateInvoiceForHousehold(
        document.householdId,
        [parsed.invoiceNumber],
        documentId,
      );
      if (duplicate) {
        throw new DuplicateInvoiceError(parsed.invoiceNumber);
      }
    }

    if (!parsed.visitDate) {
      throw new Error(
        'Visit date was not detected in OCR text. Please upload a clearer document that includes the visit date.',
      );
    }
    const extractedVisitDate: Date = parsed.visitDate;

    let clinic = null;
    if (parsed.clinicName) {
      clinic = await this.prisma.clinic.findFirst({
        where: { name: { equals: parsed.clinicName, mode: 'insensitive' } },
      });
      if (!clinic) {
        clinic = await this.prisma.clinic.create({
          data: {
            name: parsed.clinicName,
            address: parsed.clinicAddress,
            phone: parsed.clinicPhone,
          },
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { ocrStatus: DocumentStatus.OCR_IN_PROGRESS },
      });

      await tx.ocrPage.deleteMany({ where: { documentId } });
      if (pageTexts.length > 0) {
        await tx.ocrPage.createMany({
          data: pageTexts.map((fullText, index) => ({
            documentId,
            pageNumber: index + 1,
            fullText,
            rawOcrJson: { provider: 'ocr-engine', fullText },
          })),
        });
      }

      await tx.extractedField.deleteMany({ where: { documentId } });
      if (parsed.extractedFields.length > 0) {
        await tx.extractedField.createMany({
          data: parsed.extractedFields.map((field) => ({
            documentId,
            fieldName: field.fieldName,
            fieldValue: field.fieldValue,
            confidence: field.confidence,
            sourcePage: 1,
          })),
        });
      }

      const parsedSections: ParsedPetSection[] = parsed.petSections.length
        ? parsed.petSections
        : [];

      const highConfidenceNames = new Set(
        parsed.petSections.map((section) => normalizePetName(section.petName)),
      );
      this.ocrDebug('Candidate extraction', {
        parsedSectionCount: parsedSections.length,
        highConfidenceNames: Array.from(highConfidenceNames),
      });

      const vettedSections = parsedSections.filter((section) => {
        if (document.pet && normalizePetName(section.petName) === normalizePetName(document.pet.name)) {
          return true;
        }
        if (highConfidenceNames.has(normalizePetName(section.petName))) {
          return true;
        }
        return section.totalCharges !== undefined;
      });

      if (!vettedSections.length) {
        throw new Error(
          'Pet name was not detected in OCR text. Please upload a clearer document that includes the pet name.',
        );
      }

      if (vettedSections.length > 6) {
        throw new Error('Too many pet candidates detected; refusing low-confidence ingestion');
      }

      const householdPets = await tx.pet.findMany({
        where: { householdId: document.householdId },
        select: { id: true, name: true },
      });
      const existingByNormalized = new Map(
        householdPets.map((pet) => [normalizePetName(pet.name), pet]),
      );

      const approvedCandidates = await tx.documentPetCandidate.findMany({
        where: {
          documentId,
          status: PetCandidateStatus.APPROVED,
          matchedPetId: { not: null },
        },
        select: { normalizedName: true, matchedPetId: true },
      });

      const approvedByName = new Map(
        approvedCandidates.map((candidate) => [
          normalizePetName(candidate.normalizedName),
          candidate.matchedPetId as string,
        ]),
      );

      const unresolved = new Set<string>();
      const sectionsWithPets: Array<{
        section: ParsedPetSection;
        pet: { id: string; name: string };
      }> = [];

      for (const section of vettedSections) {
        const normalized = normalizePetName(section.petName);
        const existing = existingByNormalized.get(normalized);
        if (existing) {
          sectionsWithPets.push({ section: { ...section, petName: existing.name }, pet: existing });
          continue;
        }

        const approvedPetId = approvedByName.get(normalized);
        if (approvedPetId) {
          const pet = householdPets.find((row) => row.id === approvedPetId);
          if (pet) {
            sectionsWithPets.push({ section: { ...section, petName: pet.name }, pet });
            continue;
          }
        }

        unresolved.add(section.petName);
      }
      this.ocrDebug('Section vetting summary', {
        vettedSectionCount: vettedSections.length,
        resolvedPetCount: sectionsWithPets.length,
        unresolvedCandidates: Array.from(unresolved),
      });

      await tx.documentPetCandidate.deleteMany({ where: { documentId } });

      if (unresolved.size > 0) {
        await tx.documentPetCandidate.createMany({
          data: Array.from(unresolved).map((name) => ({
            documentId,
            detectedName: name,
            normalizedName: name,
            confidence: 0.6,
            status: PetCandidateStatus.PENDING,
          })),
        });

        await tx.document.update({
          where: { id: documentId },
          data: {
            clinicId: clinic?.id,
            visitDate: extractedVisitDate,
            petId: null,
            ocrStatus: DocumentStatus.NEEDS_REVIEW,
            processedAt: new Date(),
          },
        });

        await tx.visitLineItem.deleteMany({ where: { visit: { documentId } } });
        await tx.reminder.deleteMany({ where: { visit: { documentId } } });
        await tx.weightMeasurement.deleteMany({ where: { visit: { documentId } } });
        await tx.visit.deleteMany({ where: { documentId } });
        return;
      }

      const existingVisits = await tx.visit.findMany({
        where: { documentId },
        select: { id: true, petId: true },
      });

      const retainedPetIds = new Set(sectionsWithPets.map(({ pet }) => pet.id));
      const toDelete = existingVisits.filter((visit) => !retainedPetIds.has(visit.petId));
      for (const visit of toDelete) {
        await tx.reminder.deleteMany({ where: { visitId: visit.id } });
        await tx.weightMeasurement.deleteMany({ where: { visitId: visit.id } });
        await tx.visit.delete({ where: { id: visit.id } });
      }

      const isSinglePetDocument = sectionsWithPets.length === 1;
      const effectiveVisitDate = extractedVisitDate;

      for (const { section, pet } of sectionsWithPets) {
        const visit = await tx.visit.upsert({
          where: {
            documentId_petId: { documentId, petId: pet.id },
          },
          update: {
            clinicId: clinic?.id,
            visitDate: effectiveVisitDate,
            printedAt: parsed.printedAt,
            invoiceNumber: parsed.invoiceNumber,
            accountNumber: parsed.accountNumber,
            totalCharges:
              section.totalCharges !== undefined
                ? new Prisma.Decimal(section.totalCharges)
                : isSinglePetDocument && parsed.totalCharges !== undefined
                  ? new Prisma.Decimal(parsed.totalCharges)
                  : undefined,
            totalPayments:
              isSinglePetDocument && parsed.totalPayments !== undefined
                ? new Prisma.Decimal(parsed.totalPayments)
                : null,
            balance:
              isSinglePetDocument && parsed.balance !== undefined
                ? new Prisma.Decimal(parsed.balance)
                : null,
          },
          create: {
            documentId,
            petId: pet.id,
            clinicId: clinic?.id,
            visitDate: effectiveVisitDate,
            printedAt: parsed.printedAt,
            invoiceNumber: parsed.invoiceNumber,
            accountNumber: parsed.accountNumber,
            totalCharges:
              section.totalCharges !== undefined
                ? new Prisma.Decimal(section.totalCharges)
                : isSinglePetDocument && parsed.totalCharges !== undefined
                  ? new Prisma.Decimal(parsed.totalCharges)
                  : undefined,
            totalPayments:
              isSinglePetDocument && parsed.totalPayments !== undefined
                ? new Prisma.Decimal(parsed.totalPayments)
                : undefined,
            balance:
              isSinglePetDocument && parsed.balance !== undefined
                ? new Prisma.Decimal(parsed.balance)
                : undefined,
          },
        });

        await tx.visitLineItem.deleteMany({ where: { visitId: visit.id } });
        if (section.lineItems.length > 0) {
          await tx.visitLineItem.createMany({
            data: section.lineItems.map((lineItem) => ({
              visitId: visit.id,
              serviceDate: lineItem.serviceDate,
              description: lineItem.description,
              totalPrice:
                lineItem.totalPrice !== undefined
                  ? new Prisma.Decimal(lineItem.totalPrice)
                  : undefined,
            })),
          });
        }

        await tx.reminder.deleteMany({ where: { visitId: visit.id } });
        if (section.reminders.length > 0) {
          await tx.reminder.createMany({
            data: section.reminders.map((reminder) => ({
              petId: pet.id,
              visitId: visit.id,
              serviceName: reminder.serviceName,
              dueDate: reminder.dueDate,
              lastDoneDate: reminder.lastDoneDate,
            })),
          });
        }

        await tx.weightMeasurement.deleteMany({ where: { visitId: visit.id } });
        if (section.weightValue !== undefined) {
          await tx.weightMeasurement.create({
            data: {
              petId: pet.id,
              visitId: visit.id,
              measuredAt: effectiveVisitDate,
              weightValue: new Prisma.Decimal(section.weightValue),
              weightUnit: section.weightUnit || 'lbs',
              source: 'ocr_parser',
            },
          });
        }
      }

      await tx.document.update({
        where: { id: documentId },
        data: {
          clinicId: clinic?.id,
          petId: sectionsWithPets.length === 1 ? sectionsWithPets[0].pet.id : null,
          visitDate: extractedVisitDate,
          ocrStatus: DocumentStatus.PARSE_COMPLETE,
          processedAt: new Date(),
        },
      });
      this.ocrDebug('Document parse complete', {
        documentId,
        visitsWritten: sectionsWithPets.length,
      });
    });

    return this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        pages: true,
        extractedFields: true,
        petCandidates: true,
        visits: {
          include: {
            pet: true,
            lineItems: true,
            reminders: true,
            weights: true,
          },
        },
      },
    });
  }
}
