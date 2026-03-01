import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateHouseholdDto } from './dto/create-household.dto';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateHouseholdDto) {
    return this.prisma.household.create({ data: dto });
  }

  findAll() {
    return this.prisma.household.findMany({
      orderBy: { createdAt: 'desc' },
      include: { pets: true },
    });
  }
}
