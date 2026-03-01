import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { ListPetsDto } from './dto/list-pets.dto';

@Injectable()
export class PetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePetDto) {
    return this.prisma.pet.create({
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      },
    });
  }

  async findAll(query: ListPetsDto) {
    const where: Prisma.PetWhereInput = {
      householdId: query.householdId,
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
