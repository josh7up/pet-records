import {
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
    await this.ocrService
      .assertNoDuplicateInvoiceForUpload(dto, files)
      .catch(async (error) => {
        await Promise.all(files.map(async (file) => unlink(file.path).catch(() => undefined)));
        throw error;
      });

    const document = await this.documentsService.createFromImages(dto, files);
    const ocr = await this.ocrService.processUploadedImages(
      document.id,
      files.map((file) => file.path),
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
}
