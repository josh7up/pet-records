import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  householdId?: string;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsDateString()
  visitDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  ocrPageCount?: number;
}
