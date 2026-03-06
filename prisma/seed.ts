import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  await prisma.extractedField.deleteMany();
  await prisma.ocrPage.deleteMany();
  await prisma.weightMeasurement.deleteMany();
  await prisma.reminder.deleteMany();
  await prisma.visitLineItem.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.document.deleteMany();
  await prisma.pet.deleteMany();
  await prisma.clinic.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.household.deleteMany();
  await prisma.user.deleteMany();

  const household = await prisma.household.create({
    data: {
      name: 'Default Household',
    },
  });

  console.log('Seed complete');
  console.log(`defaultHouseholdId=${household.id}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
