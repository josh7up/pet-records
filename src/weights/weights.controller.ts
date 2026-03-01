import { Controller, Get, Param } from '@nestjs/common';
import { WeightsService } from './weights.service';

@Controller('weights')
export class WeightsController {
  constructor(private readonly weightsService: WeightsService) {}

  @Get('pets/:petId')
  getPetWeightSeries(@Param('petId') petId: string) {
    return this.weightsService.getPetWeightSeries(petId);
  }
}
