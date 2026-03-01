import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class ListVisitsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsString()
  householdId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
