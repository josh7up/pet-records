import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentStatus,
  PetCandidateStatus,
  PetSpecies,
  Prisma,
} from '@prisma/client';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  ReviewAction,
  ReviewPetCandidatesDto,
} from '../documents/dto/review-pet-candidates.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { MockOcrDto } from './dto/mock-ocr.dto';
import { ParsedPetSection, parseVetRecordText } from './mock-vet-record.parser';

const execFileAsync = promisify(execFile);
const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<any>;

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

  private getOcrEngine() {
    return this.config.get<string>('OCR_ENGINE', 'tesseract').toLowerCase();
  }

  private isOcrDebugEnabled() {
    return this.config.get<string>('OCR_DEBUG', 'false').toLowerCase() === 'true';
  }

  private getTesseractPsm() {
    const parsed = Number(this.config.get<string>('OCR_TESSERACT_PSM', '4'));
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 13) {
      return 4;
    }
    return parsed;
  }

  private getTesseractOem() {
    const configured = this.config.get<string>('OCR_TESSERACT_OEM');
    if (!configured) {
      return undefined;
    }
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
      return undefined;
    }
    return parsed;
  }

  private getTesseractLanguage() {
    return this.config.get<string>('OCR_TESSERACT_LANG', 'eng');
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

  private isGoogleQuotaError(error: unknown) {
    const status = (error as { status?: number })?.status;
    const message = String((error as Error)?.message || error).toLowerCase();
    return (
      status === 429 ||
      message.includes('quota exceeded') ||
      message.includes('too many requests') ||
      message.includes('rate limit')
    );
  }

  private isGoogleLocalFallbackEnabled() {
    return (
      this.config
        .get<string>('GOOGLE_AI_STUDIO_FALLBACK_TO_LOCAL', 'true')
        .toLowerCase() === 'true'
    );
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

  private async rasterizePdfToImages(pdfPath: string) {
    const tempDir = await mkdtemp(join(tmpdir(), 'pet-record-pdf-'));
    const prefix = join(tempDir, 'page');

    this.ocrDebug('Rasterizing PDF', { pdfPath, prefix });
    await execFileAsync('pdftoppm', ['-png', '-r', '300', pdfPath, prefix]);

    const files = await readdir(tempDir);
    const imagePaths = files
      .filter((file) => /^page-\d+\.png$/.test(file))
      .sort((a, b) => {
        const aNum = Number(a.match(/\d+/)?.[0] || 0);
        const bNum = Number(b.match(/\d+/)?.[0] || 0);
        return aNum - bNum;
      })
      .map((file) => join(tempDir, file));

    this.ocrDebug('Rasterization complete', {
      pageCount: imagePaths.length,
      tempDir,
    });
    return { tempDir, imagePaths };
  }

  private normalizeScribeText(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }
    if (Array.isArray(result)) {
      return result
        .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
        .join('\n\n');
    }
    if (result && typeof result === 'object') {
      const candidate = result as Record<string, unknown>;
      if (typeof candidate.text === 'string') {
        return candidate.text;
      }
      if (Array.isArray(candidate.text) || typeof candidate.text === 'object') {
        return JSON.stringify(candidate.text);
      }
    }
    return String(result || '');
  }

  private async runScribeExtract(paths: string[]) {
    this.ocrDebug('Running scribe extract', { fileCount: paths.length });
    const module = await dynamicImport('scribe.js-ocr');
    const scribe = module?.default ?? module;
    if (!scribe || typeof scribe.extractText !== 'function') {
      throw new Error('scribe.js-ocr extractText API unavailable');
    }
    const result = await scribe.extractText(paths);
    this.ocrDebug('Scribe extract finished');
    return this.normalizeScribeText(result);
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

  private async preprocessWithImageMagick(inputPath: string, outputPath: string) {
    const baseArgs = [
      inputPath,
      '-auto-orient',
      '-resize',
      '2200x',
      '-colorspace',
      'Gray',
      '-normalize',
      '-sharpen',
      '0x1.4',
      '-threshold',
      '68%',
      outputPath,
    ];

    try {
      await execFileAsync('magick', baseArgs);
      return 'magick';
    } catch (firstError) {
      const err = firstError as NodeJS.ErrnoException;
      if (err.code && err.code !== 'ENOENT') {
        throw firstError;
      }
    }

    try {
      await execFileAsync('convert', baseArgs);
      return 'convert';
    } catch (secondError) {
      const err = secondError as NodeJS.ErrnoException;
      if (err.code && err.code !== 'ENOENT') {
        throw secondError;
      }
    }

    throw new Error('ImageMagick command not found (`magick` or `convert`)');
  }

  private async preprocessWithSips(inputPath: string, outputPath: string) {
    await execFileAsync('sips', [
      '-s',
      'format',
      'png',
      '--resampleHeightWidthMax',
      '3200',
      inputPath,
      '--out',
      outputPath,
    ]);
    return 'sips';
  }

  private async preprocessImagesForTesseract(paths: string[]) {
    const tempDir = await mkdtemp(join(tmpdir(), 'pet-record-ocr-pre-'));
    const processedPaths: string[] = [];

    try {
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        const outputBase = join(tempDir, `page-${index + 1}`);
        let processedPath = `${outputBase}.png`;
        let strategy = 'none';
        try {
          strategy = await this.preprocessWithImageMagick(path, processedPath);
        } catch (error) {
          this.ocrDebug('ImageMagick preprocessing unavailable', {
            inputPath: path,
            error: String((error as Error)?.message || error),
          });
          try {
            strategy = await this.preprocessWithSips(path, processedPath);
          } catch (sipsError) {
            const inputExt = extname(path).toLowerCase();
            const safeExt = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'].includes(
              inputExt,
            )
              ? inputExt
              : '.jpg';
            processedPath = `${outputBase}${safeExt}`;
            await copyFile(path, processedPath);
            strategy = 'copy-original';
            this.ocrDebug('Sips preprocessing unavailable; using original image', {
              inputPath: path,
              error: String((sipsError as Error)?.message || sipsError),
            });
          }
        }
        this.ocrDebug('OCR preprocess page complete', {
          inputPath: path,
          inputFile: basename(path),
          outputPath: processedPath,
          strategy,
        });
        processedPaths.push(processedPath);
      }
      return { tempDir, processedPaths };
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  private async runTesseractExtract(paths: string[]) {
    const tesseractPsm = this.getTesseractPsm();
    const tesseractOem = this.getTesseractOem();
    const tesseractLang = this.getTesseractLanguage();
    const { tempDir, processedPaths } = await this.preprocessImagesForTesseract(paths);
    const pageTexts: string[] = [];

    const scoreOcrText = (text: string) => {
      const normalized = text.toLowerCase();
      const keywordPatterns = [
        /\bveterinary\b/g,
        /\bprinted\b/g,
        /\bdate\b/g,
        /\baccount\b/g,
        /\binvoice\b/g,
        /\bpatient\b/g,
        /\breminders?\b/g,
        /\bweight\b/g,
        /\bpurevax\b/g,
        /\brabies\b/g,
        /\bwellness\b/g,
      ];
      const keywordHits = keywordPatterns.reduce(
        (acc, pattern) => acc + (normalized.match(pattern)?.length || 0),
        0,
      );
      const dateHits = (normalized.match(/\b\d{2}-\d{2}-\d{2}\b/g) || []).length;
      const amountHits = (normalized.match(/\b-?\d+\.\d{2}\b/g) || []).length;
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const printable = text.replace(/\s/g, '');
      const weirdChars = (printable.match(/[^A-Za-z0-9.,:;()\-/$%']/g) || []).length;
      const weirdRatio = printable.length ? weirdChars / printable.length : 1;
      return keywordHits * 10 + dateHits * 4 + amountHits * 2 + lines.length * 0.1 - weirdRatio * 30;
    };

    const passConfigs = [
      { name: `psm-${tesseractPsm}`, psm: tesseractPsm, extra: [] as string[] },
      { name: 'psm-6', psm: 6, extra: [] as string[] },
      { name: 'psm-11', psm: 11, extra: [] as string[] },
      { name: 'psm-4-no-invert', psm: 4, extra: ['-c', 'tessedit_do_invert=0'] },
      { name: 'psm-6-no-invert', psm: 6, extra: ['-c', 'tessedit_do_invert=0'] },
    ];

    try {
      for (const path of processedPaths) {
        let bestText = '';
        let bestScore = Number.NEGATIVE_INFINITY;
        let bestPass = '';

        for (const pass of passConfigs) {
          const args = [path, 'stdout', '-l', tesseractLang, '--psm', String(pass.psm)];
          if (tesseractOem !== undefined) {
            args.push('--oem', String(tesseractOem));
          }
          args.push(
            '-c',
            'preserve_interword_spaces=1',
            '-c',
            'user_defined_dpi=300',
            ...pass.extra,
          );
          this.ocrDebug('Running tesseract', { path, pass: pass.name, args });
          const started = Date.now();
          const { stdout, stderr } = await execFileAsync('tesseract', args, {
            maxBuffer: 25 * 1024 * 1024,
          });
          if (stderr?.trim()) {
            this.ocrDebug('Tesseract stderr', {
              path,
              pass: pass.name,
              preview: stderr.slice(0, 1200),
            });
          }
          const score = scoreOcrText(stdout);
          this.ocrDebug('Tesseract pass scored', {
            path,
            pass: pass.name,
            elapsedMs: Date.now() - started,
            chars: stdout.length,
            score,
            preview: stdout.slice(0, 250),
          });
          if (score > bestScore) {
            bestScore = score;
            bestText = stdout;
            bestPass = pass.name;
          }
        }

        this.ocrDebug('Selected best tesseract pass', {
          path,
          bestPass,
          bestScore,
          chars: bestText.length,
          preview: bestText.slice(0, 300),
        });
        pageTexts.push(bestText);
      }
      return pageTexts.join('\n\n');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

  async processUploadedImages(documentId: string, imagePaths: string[]) {
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
        engine: this.getOcrEngine(),
        imageCount: imagePaths.length,
      });
      if (this.getOcrEngine() === 'scribe') {
        const combined = await this.runScribeExtract(imagePaths);
        pageTexts.push(combined);
      } else if (this.getOcrEngine() === 'google') {
        try {
          const combined = await this.runGoogleStudioExtract(imagePaths);
          pageTexts.push(combined);
        } catch (googleError) {
          if (this.isGoogleQuotaError(googleError) && this.isGoogleLocalFallbackEnabled()) {
            this.logger.warn(
              'Google AI Studio quota/rate-limited. Falling back to local tesseract OCR.',
            );
            const combined = await this.runTesseractExtract(imagePaths);
            pageTexts.push(combined);
          } else {
            throw googleError;
          }
        }
      } else {
        const combined = await this.runTesseractExtract(imagePaths);
        pageTexts.push(combined);
      }
    } catch (error) {
      this.logger.error('OCR image processing failed', error as Error);
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ocrStatus: DocumentStatus.FAILED },
      });
      return {
        documentId,
        status: 'failed',
        provider: this.getOcrEngine(),
        message: `OCR failed using ${this.getOcrEngine()} while reading uploaded image pages.`,
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
      return {
        documentId,
        status: 'failed',
        provider: this.getOcrEngine(),
        message:
          'OCR completed but parser could not map pet data. Use OCR reprocess with corrected text or manual field entry.',
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
        provider: this.getOcrEngine(),
        message: 'OCR completed. Review detected pet names before creating new pets.',
      };
    }

    return {
      documentId,
      status: 'parsed',
      provider: this.getOcrEngine(),
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
      engine: this.getOcrEngine(),
    });

    if (document.mimeType === 'image/png' || document.mimeType === 'image/jpeg') {
      return this.processUploadedImages(documentId, [document.filePath]);
    }

    if (document.mimeType === 'application/pdf') {
      if (this.getOcrEngine() === 'google') {
        try {
          await this.prisma.document.update({
            where: { id: documentId },
            data: { ocrStatus: DocumentStatus.OCR_IN_PROGRESS },
          });
          let combined = '';
          try {
            combined = await this.runGoogleStudioExtract(
              [document.filePath],
              ['application/pdf'],
            );
          } catch (googleError) {
            if (!(this.isGoogleQuotaError(googleError) && this.isGoogleLocalFallbackEnabled())) {
              throw googleError;
            }

            this.logger.warn(
              'Google AI Studio quota/rate-limited for PDF. Falling back to pdftoppm+tesseract OCR.',
            );
            let tempDir: string | undefined;
            try {
              const rasterized = await this.rasterizePdfToImages(document.filePath);
              tempDir = rasterized.tempDir;
              if (!rasterized.imagePaths.length) {
                throw new Error('No pages were rendered from PDF');
              }
              combined = await this.runTesseractExtract(rasterized.imagePaths);
            } finally {
              if (tempDir) {
                await rm(tempDir, { recursive: true, force: true });
              }
            }
          }
          await this.parseAndPersist(documentId, combined, [combined]);
          const updated = await this.prisma.document.findUnique({
            where: { id: documentId },
            select: { ocrStatus: true },
          });
          if (updated?.ocrStatus === DocumentStatus.NEEDS_REVIEW) {
            return {
              documentId,
              status: 'needs_review',
              provider: 'google-ai-studio',
              message: 'AI extraction completed. Review detected pet names before creating new pets.',
            };
          }
          return {
            documentId,
            status: 'parsed',
            provider: 'google-ai-studio',
            message: 'AI extraction and parsing completed.',
          };
        } catch (googleError) {
          this.logger.error('Google AI Studio extraction failed', googleError as Error);
          await this.prisma.document.update({
            where: { id: documentId },
            data: { ocrStatus: DocumentStatus.FAILED },
          });
          return {
            documentId,
            status: 'failed',
            provider: 'google-ai-studio',
            message: `AI extraction failed. ${String(
              (googleError as Error)?.message || googleError,
            )}`,
          };
        }
      }

      if (this.getOcrEngine() === 'scribe') {
        try {
          await this.prisma.document.update({
            where: { id: documentId },
            data: { ocrStatus: DocumentStatus.OCR_IN_PROGRESS },
          });
          const combined = await this.runScribeExtract([document.filePath]);
          await this.parseAndPersist(documentId, combined, [combined]);
          const updated = await this.prisma.document.findUnique({
            where: { id: documentId },
            select: { ocrStatus: true },
          });
          if (updated?.ocrStatus === DocumentStatus.NEEDS_REVIEW) {
            return {
              documentId,
              status: 'needs_review',
              provider: 'scribe',
              message: 'OCR completed. Review detected pet names before creating new pets.',
            };
          }
          return {
            documentId,
            status: 'parsed',
            provider: 'scribe',
            message: 'OCR and parsing completed.',
          };
        } catch (scribeError) {
          this.logger.error('Scribe OCR failed, attempting fallback', scribeError as Error);
          let tempDir: string | undefined;
          try {
            const rasterized = await this.rasterizePdfToImages(document.filePath);
            tempDir = rasterized.tempDir;
            if (!rasterized.imagePaths.length) {
              throw new Error('No pages were rendered from PDF');
            }
            const fallbackResult = await this.processUploadedImages(
              documentId,
              rasterized.imagePaths,
            );
            return {
              ...fallbackResult,
              provider: 'scribe->tesseract-fallback',
              message:
                fallbackResult.status === 'parsed' ||
                fallbackResult.status === 'needs_review'
                  ? 'Scribe OCR failed; fallback OCR completed via pdftoppm+tesseract.'
                  : `Scribe OCR failed and fallback OCR failed. Scribe error: ${String(
                      (scribeError as Error)?.message || scribeError,
                    )}`,
            };
          } catch (fallbackError) {
            this.logger.error('Fallback OCR also failed', fallbackError as Error);
            await this.prisma.document.update({
              where: { id: documentId },
              data: { ocrStatus: DocumentStatus.FAILED },
            });
            return {
              documentId,
              status: 'failed',
              provider: 'scribe->tesseract-fallback',
              message: `PDF OCR failed using scribe and fallback. Scribe: ${String(
                (scribeError as Error)?.message || scribeError,
              )}; fallback: ${String((fallbackError as Error)?.message || fallbackError)}`,
            };
          } finally {
            if (tempDir) {
              await rm(tempDir, { recursive: true, force: true });
            }
          }
        }
      }

      let tempDir: string | undefined;
      try {
        const rasterized = await this.rasterizePdfToImages(document.filePath);
        tempDir = rasterized.tempDir;
        if (!rasterized.imagePaths.length) {
          throw new Error('No pages were rendered from PDF');
        }
        return await this.processUploadedImages(documentId, rasterized.imagePaths);
      } catch (error) {
        this.logger.error('PDF rasterization/tesseract path failed', error as Error);
        await this.prisma.document.update({
          where: { id: documentId },
          data: { ocrStatus: DocumentStatus.FAILED },
        });
        return {
          documentId,
          status: 'failed',
          provider: 'pdftoppm+tesseract',
          message:
            'PDF OCR failed. Install poppler-utils (`pdftoppm`) or use image upload mode.',
        };
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true });
        }
      }
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
        'Unsupported file type for local OCR. Upload PDF/JPG/PNG.',
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
