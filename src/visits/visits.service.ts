import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListVisitsDto } from './dto/list-visits.dto';

@Injectable()
export class VisitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListVisitsDto) {
    const where: Prisma.VisitWhereInput = {
      petId: query.petId,
      pet: query.householdId ? { householdId: query.householdId } : undefined,
      visitDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
    };

    const skip = (query.page - 1) * query.pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        include: {
          pet: true,
          clinic: true,
          lineItems: true,
          reminders: true,
          weights: true,
          document: true,
        },
        skip,
        take: query.pageSize,
        orderBy: { visitDate: 'desc' },
      }),
      this.prisma.visit.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
  }
}
