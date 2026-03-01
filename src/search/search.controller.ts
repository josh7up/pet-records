import { Controller, Get, Query } from '@nestjs/common';
import { SearchRecordsDto } from './dto/search-records.dto';
import { SearchService } from './search.service';

@Controller('records')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('search')
  search(@Query() query: SearchRecordsDto) {
    return this.searchService.search(query);
  }
}
