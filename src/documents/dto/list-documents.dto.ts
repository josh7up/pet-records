import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { DocumentStatus } from '@prisma/client';

export class ListDocumentsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  householdId?: string;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
