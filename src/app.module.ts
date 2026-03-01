import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { HouseholdsModule } from './households/households.module';
import { PetsModule } from './pets/pets.module';
import { DocumentsModule } from './documents/documents.module';
import { VisitsModule } from './visits/visits.module';
import { SearchModule } from './search/search.module';
import { WeightsModule } from './weights/weights.module';
import { OcrModule } from './ocr/ocr.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HouseholdsModule,
    PetsModule,
    DocumentsModule,
    VisitsModule,
    SearchModule,
    WeightsModule,
    OcrModule,
  ],
})
export class AppModule {}
