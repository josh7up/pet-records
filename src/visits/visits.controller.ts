import { Controller, Get, Query } from '@nestjs/common';
import { ListVisitsDto } from './dto/list-visits.dto';
import { VisitsService } from './visits.service';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Get()
  findAll(@Query() query: ListVisitsDto) {
    return this.visitsService.findAll(query);
  }
}
