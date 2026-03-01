import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class ExtractedFieldInputDto {
  @IsString()
  @MaxLength(120)
  fieldName!: string;

  @IsString()
  fieldValue!: string;

  @IsOptional()
  @Type(() => Number)
  confidence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourcePage?: number;
}

export class UpsertExtractedFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtractedFieldInputDto)
  fields!: ExtractedFieldInputDto[];
}
