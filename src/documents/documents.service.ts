import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentStatus, Prisma } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpsertExtractedFieldsDto } from './dto/upsert-extracted-fields.dto';
import { safeFilename } from './utils/multer-upload';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: UploadDocumentDto, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File upload missing');
    }

    const document = await this.prisma.document.create({
      data: {
        householdId: dto.householdId,
        petId: dto.petId,
        clinicId: dto.clinicId,
        visitDate: dto.visitDate ? new Date(dto.visitDate) : null,
        originalName: file.originalname,
        filePath: file.path,
        mimeType: file.mimetype,
        ocrStatus: DocumentStatus.UPLOADED,
      },
    });

    return document;
  }

  async createFromImages(dto: UploadDocumentDto, files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('Image upload missing');
    }

    const unsupported = files.find(
      (file) => file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png',
    );
    if (unsupported) {
      throw new BadRequestException(
        `Unsupported image type: ${unsupported.mimetype}. Use JPG or PNG.`,
      );
    }

    const pdf = await PDFDocument.create();
    for (const file of files) {
      const bytes = await readFile(file.path);
      const image =
        file.mimetype === 'image/png'
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);

      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const outputPath = join(
      dirname(files[0].path),
      safeFilename(`${files[0].originalname}-combined.pdf`),
    );
    const pdfBytes = await pdf.save();
    await writeFile(outputPath, pdfBytes);

    const document = await this.prisma.document.create({
      data: {
        householdId: dto.householdId,
        petId: dto.petId,
        clinicId: dto.clinicId,
        visitDate: dto.visitDate ? new Date(dto.visitDate) : null,
        originalName: `combined-${files.length}-pages.pdf`,
        filePath: outputPath,
        mimeType: 'application/pdf',
        ocrStatus: DocumentStatus.UPLOADED,
      },
    });

    return document;
  }

  async findAll(query: ListDocumentsDto) {
    const where: Prisma.DocumentWhereInput = {
      householdId: query.householdId,
      petId: query.petId,
      ocrStatus: query.status,
      visitDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
    };

    const skip = (query.page - 1) * query.pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        include: {
          pet: true,
          clinic: true,
          visits: { include: { pet: true, lineItems: true, reminders: true, weights: true } },
          pages: true,
          extractedFields: true,
          petCandidates: true,
        },
        skip,
        take: query.pageSize,
        orderBy: { uploadedAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        pet: true,
        clinic: true,
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

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  async getFilePath(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { filePath: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document.filePath;
  }

  async upsertExtractedFields(id: string, dto: UpsertExtractedFieldsDto) {
    await this.findOne(id);

    await this.prisma.$transaction([
      this.prisma.extractedField.deleteMany({ where: { documentId: id } }),
      this.prisma.extractedField.createMany({
        data: dto.fields.map((field) => ({
          documentId: id,
          fieldName: field.fieldName,
          fieldValue: field.fieldValue,
          confidence: field.confidence,
          sourcePage: field.sourcePage,
        })),
      }),
    ]);

    return this.findOne(id);
  }

  async remove(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, filePath: true },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.prisma.document.delete({
      where: { id },
    });

    await unlink(document.filePath).catch(() => undefined);

    return { id: document.id, deleted: true };
  }
}
