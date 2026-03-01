import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SearchRecordsDto } from './dto/search-records.dto';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchRecordsDto) {
    const where: Prisma.VisitWhereInput = {
      petId: query.petId,
      invoiceNumber: query.invoiceNumber
        ? { contains: query.invoiceNumber, mode: 'insensitive' }
        : undefined,
      visitDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
      totalCharges:
        query.minTotal !== undefined || query.maxTotal !== undefined
          ? {
              gte: query.minTotal,
              lte: query.maxTotal,
            }
          : undefined,
      pet: {
        householdId: query.householdId,
        name: query.petName
          ? { contains: query.petName, mode: 'insensitive' }
          : undefined,
      },
      clinic: query.clinicName
        ? { name: { contains: query.clinicName, mode: 'insensitive' } }
        : undefined,
      lineItems: query.service
        ? {
            some: {
              description: {
                contains: query.service,
                mode: 'insensitive',
              },
            },
          }
        : undefined,
      OR: query.text
        ? [
            {
              lineItems: {
                some: {
                  description: {
                    contains: query.text,
                    mode: 'insensitive',
                  },
                },
              },
            },
            {
              document: {
                pages: {
                  some: {
                    fullText: {
                      contains: query.text,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            },
          ]
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
          document: {
            include: {
              pages: true,
              extractedFields: true,
            },
          },
        },
        orderBy: { visitDate: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.visit.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
