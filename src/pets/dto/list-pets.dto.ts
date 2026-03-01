import { PetSpecies } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class ListPetsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  householdId?: string;

  @IsOptional()
  @IsEnum(PetSpecies)
  species?: PetSpecies;

  @IsOptional()
  @IsString()
  q?: string;
}
