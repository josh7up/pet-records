import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { ListPetsDto } from './dto/list-pets.dto';

@Injectable()
export class PetsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHouseholdId() {
    const existing = await this.prisma.household.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }
    const created = await this.prisma.household.create({
      data: { name: 'Default Household' },
      select: { id: true },
    });
    return created.id;
  }

  async create(dto: CreatePetDto) {
    const householdId = await this.resolveHouseholdId();
    return this.prisma.pet.create({
      data: {
        ...dto,
        householdId,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      },
    });
  }

  async findAll(query: ListPetsDto) {
    const where: Prisma.PetWhereInput = {
      species: query.species,
      name: query.q ? { contains: query.q, mode: 'insensitive' } : undefined,
    };

    const skip = (query.page - 1) * query.pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.pet.findMany({
        where,
        include: { household: true },
        skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.pet.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findOne(id: string) {
    const pet = await this.prisma.pet.findUnique({
      where: { id },
      include: {
        visits: { orderBy: { visitDate: 'desc' }, take: 10 },
        weights: { orderBy: { measuredAt: 'desc' }, take: 30 },
      },
    });

    if (!pet) {
      throw new NotFoundException('Pet not found');
    }

    return pet;
  }
}
