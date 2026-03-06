import { IsDateString, IsOptional, IsString } from 'class-validator';

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
}
