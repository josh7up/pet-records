import {
  Delete,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Response } from 'express';
import { OcrService } from '../ocr/ocr.service';
import { DocumentsService } from './documents.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpsertExtractedFieldsDto } from './dto/upsert-extracted-fields.dto';
import { uploadStorage } from './utils/multer-upload';

const parseDateFromFilename = (name: string) => {
  const match = name.match(/(\d{4})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2})(\d{2}))?/);
  if (!match) {
    return null;
  }
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = hourRaw ? Number(hourRaw) : 0;
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  const second = secondRaw ? Number(secondRaw) : 0;
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second)
  ) {
    return null;
  }
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp;
};

const sortFilesByFilenameDate = (files: Express.Multer.File[]) => {
  const annotated = files.map((file, index) => {
    const sourceName = file.originalname || file.filename || '';
    return {
      file,
      index,
      timestamp: parseDateFromFilename(sourceName),
    };
  });
  annotated.sort((a, b) => {
    if (a.timestamp != null && b.timestamp != null) {
      if (a.timestamp === b.timestamp) {
        return a.index - b.index;
      }
      return a.timestamp - b.timestamp;
    }
    if (a.timestamp != null) return -1;
    if (b.timestamp != null) return 1;
    return a.index - b.index;
  });
  return annotated.map((item) => item.file);
};

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly ocrService: OcrService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
    }),
  )
  async upload(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File upload missing');
    }
    await this.ocrService
      .assertNoDuplicateInvoiceForUpload(dto, [file])
      .catch(async (error) => {
        await unlink(file.path).catch(() => undefined);
        throw error;
      });

    const document = await this.documentsService.create(dto, file);
    const ocr = await this.ocrService.processUploadedDocument(document.id);

    return { document, ocr };
  }

  @Post('upload-images')
  @UseInterceptors(
    FilesInterceptor('files', 25, {
      storage: uploadStorage,
    }),
  )
  async uploadImages(
    @Body() dto: UploadDocumentDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Image upload missing');
    }
    const orderedFiles = sortFilesByFilenameDate(files);
    await this.ocrService
      .assertNoDuplicateInvoiceForUpload(dto, orderedFiles)
      .catch(async (error) => {
        await Promise.all(files.map(async (file) => unlink(file.path).catch(() => undefined)));
        throw error;
      });

    const document = await this.documentsService.createFromImages(dto, orderedFiles);
    const ocrPageCount = dto.ocrPageCount && dto.ocrPageCount > 0
      ? Math.min(dto.ocrPageCount, files.length)
      : undefined;
    const ocrFiles = ocrPageCount ? files.slice(0, ocrPageCount) : orderedFiles;
    const ocr = await this.ocrService.processUploadedImages(
      document.id,
      ocrFiles.map((file) => file.path),
    );
    await Promise.all(files.map(async (file) => unlink(file.path).catch(() => undefined)));

    return { document, ocr };
  }

  @Get()
  findAll(@Query() query: ListDocumentsDto) {
    return this.documentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Get(':id/file')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const path = await this.documentsService.getFilePath(id);

    if (!existsSync(path)) {
      throw new NotFoundException('File not found');
    }

    return res.sendFile(path, { root: process.cwd() });
  }

  @Patch(':id/fields')
  upsertFields(
    @Param('id') id: string,
    @Body() dto: UpsertExtractedFieldsDto,
  ) {
    return this.documentsService.upsertExtractedFields(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
