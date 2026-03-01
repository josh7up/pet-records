import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class WeightsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPetWeightSeries(petId: string) {
    const points = await this.prisma.weightMeasurement.findMany({
      where: { petId },
      orderBy: { measuredAt: 'asc' },
      select: {
        id: true,
        measuredAt: true,
        weightValue: true,
        weightUnit: true,
        source: true,
        visit: {
          select: {
            id: true,
            visitDate: true,
            documentId: true,
          },
        },
      },
    });

    return {
      petId,
      points,
      stats: {
        count: points.length,
        latest: points.length ? points[points.length - 1] : null,
      },
    };
  }
}
