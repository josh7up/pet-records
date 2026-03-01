import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class SearchRecordsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  householdId?: string;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  petName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  service?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clinicName?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxTotal?: number;

  @IsOptional()
  @IsString()
  text?: string;
}
