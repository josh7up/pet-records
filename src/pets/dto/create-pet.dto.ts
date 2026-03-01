import { PetSpecies } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePetDto {
  @IsString()
  @IsNotEmpty()
  householdId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(PetSpecies)
  species!: PetSpecies;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  breed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sex?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
