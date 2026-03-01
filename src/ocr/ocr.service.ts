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
import { MockOcrDto } from './dto/mock-ocr.dto';
import { ParsedPetSection, parseVetRecordText } from './mock-vet-record.parser';
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

function extractHighConfidencePetNamesFromRawText(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const stopwords = new Set([
    'golden',
    'corner',
    'veterinary',
    'hospital',
    'date',
    'for',
    'qty',
    'description',
    'price',
    'discount',
    'patient',
    'total',
    'charges',
    'payments',
    'balance',
    'old',
    'new',
    'invoice',
    'account',
    'printed',
    'visa',
    'payment',
    'reminders',
    'weight',
    'last',
    'done',
    'annual',
    'exam',
    'rabies',
    'purevax',
    'combo',
    'test',
    'feline',
    'monitoring',
    'snap',
    'thyroid',
    'intestinal',
    'flotation',
    'credit',
    'card',
    'fee',
    'recomb',
    'profile',
  ]);

  const scoreByName = new Map<string, number>();
  const bump = (name: string, score: number) => {
    scoreByName.set(name, (scoreByName.get(name) || 0) + score);
  };

  const normalizeCandidate = (value: string) => {
    const normalized = value.replace(/[^A-Za-z' -]/g, '').replace(/\s+/g, ' ').trim();
    if (!/^[A-Za-z][A-Za-z' -]{1,24}$/.test(normalized)) {
      return undefined;
    }

    const tokenCount = normalized.split(' ').filter(Boolean).length;
    if (tokenCount > 2) {
      return undefined;
    }

    const lettersOnly = normalized.replace(/[^A-Za-z]/g, '');
    if (lettersOnly.length < 3 || lettersOnly.length > 20) {
      return undefined;
    }

    const upper = lettersOnly.replace(/[^A-Z]/g, '').length;
    const lower = lettersOnly.replace(/[^a-z]/g, '').length;
    const firstToken = normalized.split(' ')[0]?.toLowerCase() || '';
    if (stopwords.has(firstToken)) {
      return undefined;
    }
    if (lower === 0 && lettersOnly.length > 5) {
      return undefined;
    }
    if (upper / lettersOnly.length > 0.8 && lettersOnly.length >= 5) {
      return undefined;
    }

    return normalized
      .toLowerCase()
      .split(' ')
      .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
      .join(' ');
  };

  for (const line of lines) {
    const reminderMatch = line.match(
      /reminders?\s*for[^A-Za-z]*([A-Za-z][A-Za-z' -]{1,30})(?:\s*\(|\s*$)/i,
    );
    if (reminderMatch) {
      const normalized = normalizeCandidate(reminderMatch[1]);
      if (normalized) {
        bump(normalized, 6);
      }
    }
  }

  const patientIndex = lines.findIndex((line) => /^patient$/i.test(line));
  if (patientIndex >= 0) {
    for (let index = patientIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^reminders?\s+for/i.test(line)) {
        break;
      }
      const nameAmount = line.match(/^([A-Za-z][A-Za-z' -]{1,30})\s+(-?\d+\.\d{2})$/);
      if (nameAmount) {
        const normalized = normalizeCandidate(nameAmount[1]);
        if (normalized) {
          bump(normalized, 5);
        }
      }

      if (/^[A-Za-z][A-Za-z' -]{2,24}$/.test(line) && !/^(total|charges?)$/i.test(line)) {
        const nextLine = lines[index + 1] || '';
        if (/^-?\d+\.\d{2}$/.test(nextLine)) {
          const normalized = normalizeCandidate(line);
          if (normalized) {
            bump(normalized, 4);
          }
        }
      }
    }
  }

  for (const line of lines) {
    const onlyDateAndName = line.match(/^\d{2}[-/]\d{2}[-/]\d{2}\s+([A-Za-z][A-Za-z' -]{1,20})$/);
    if (onlyDateAndName) {
      const normalized = normalizeCandidate(onlyDateAndName[1]);
      if (normalized) {
        bump(normalized, 3);
      }
    }
  }

  return Array.from(scoreByName.entries())
    .filter(([, score]) => score >= 5)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
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

  async assertNoDuplicateInvoiceForUpload(
    dto: Pick<UploadDocumentDto, 'householdId'>,
    files: Express.Multer.File[],
  ) {
    const invoiceCandidates = await this.collectInvoiceCandidatesForUpload(files);
    const duplicate = await this.findDuplicateInvoiceForHousehold(
      dto.householdId,
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

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      {
        text:
          'Extract all readable text from this veterinary receipt/document. ' +
          'Return plain text only. Preserve line breaks, headings, table-like rows, numbers, dates, and pet names. ' +
          'Do not summarize and do not add commentary.',
      },
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
        const result = await model.generateContent(parts);
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
      const combined = await this.runGoogleStudioExtract(imagePaths, mimeTypeOverrides);
      pageTexts.push(combined);
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
      await this.parseAndPersist(documentId, combinedText, pageTexts);
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
        message:
          'OCR completed but parser could not map pet data. Fix the upload content and try uploading again, or use manual field entry.',
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
      message: 'OCR and parsing completed.',
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

  async mockParseDocument(documentId: string, dto: MockOcrDto) {
    return this.parseAndPersist(documentId, dto.rawText, [dto.rawText]);
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
    await this.parseAndPersist(documentId, rawText, document.pages.map((page) => page.fullText));

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
  ) {
    this.ocrDebug('parseAndPersist start', {
      documentId,
      textChars: rawText.length,
      pageCount: pageTexts.length,
    });
    const parsed = parseVetRecordText(rawText);
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
        : document.pet
          ? [
              {
                petName: document.pet.name,
                totalCharges: parsed.totalCharges,
                weightValue: parsed.weightValue,
                weightUnit: parsed.weightUnit,
                lineItems: parsed.lineItems,
                reminders: parsed.reminders,
              },
            ]
          : extractHighConfidencePetNamesFromRawText(rawText).map((petName) => ({
              petName,
              totalCharges: undefined,
              weightValue: undefined,
              weightUnit: undefined,
              lineItems: [],
              reminders: [],
            }));

      const highConfidenceNames = new Set(
        extractHighConfidencePetNamesFromRawText(rawText).map((name) => normalizePetName(name)),
      );
      this.ocrDebug('Candidate extraction', {
        parsedSectionCount: parsedSections.length,
        highConfidenceNames: Array.from(highConfidenceNames),
      });

      const vettedSections = parsedSections.filter((section) => {
        if (document.pet && normalizePetName(section.petName) === normalizePetName(document.pet.name)) {
          return true;
        }
        return highConfidenceNames.has(normalizePetName(section.petName));
      });

      if (!vettedSections.length) {
        throw new Error('No pet sections detected in OCR text');
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
            visitDate: parsed.visitDate,
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
      const effectiveVisitDate =
        parsed.visitDate || document.visitDate || document.uploadedAt || new Date();

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
          visitDate: parsed.visitDate,
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
