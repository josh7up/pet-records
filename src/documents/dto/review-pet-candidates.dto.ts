import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export enum ReviewAction {
  LINK = 'link',
  CREATE = 'create',
  REJECT = 'reject',
}

export class ReviewDecisionDto {
  @IsString()
  candidateId!: string;

  @IsEnum(ReviewAction)
  action!: ReviewAction;

  @IsOptional()
  @IsString()
  petId?: string;

  @IsOptional()
  @IsString()
  petName?: string;
}

export class ReviewPetCandidatesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReviewDecisionDto)
  decisions!: ReviewDecisionDto[];
}
