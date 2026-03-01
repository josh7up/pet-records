import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreatePetDto } from './dto/create-pet.dto';
import { ListPetsDto } from './dto/list-pets.dto';
import { PetsService } from './pets.service';

@Controller('pets')
export class PetsController {
  constructor(private readonly petsService: PetsService) {}

  @Post()
  create(@Body() dto: CreatePetDto) {
    return this.petsService.create(dto);
  }

  @Get()
  findAll(@Query() query: ListPetsDto) {
    return this.petsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.petsService.findOne(id);
  }
}
