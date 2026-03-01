import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateHouseholdDto } from './dto/create-household.dto';
import { HouseholdsService } from './households.service';

@Controller('households')
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) {}

  @Post()
  create(@Body() dto: CreateHouseholdDto) {
    return this.householdsService.create(dto);
  }

  @Get()
  findAll() {
    return this.householdsService.findAll();
  }
}
