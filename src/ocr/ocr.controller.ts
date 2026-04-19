import { Body, Controller, Param, Post } from '@nestjs/common';
import { ReviewPetCandidatesDto } from '../documents/dto/review-pet-candidates.dto';
import { OcrService } from './ocr.service';

@Controller('ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post(':documentId/review-pets')
  reviewPets(
    @Param('documentId') documentId: string,
    @Body() dto: ReviewPetCandidatesDto,
  ) {
    return this.ocrService.reviewPetCandidates(documentId, dto);
  }
}
