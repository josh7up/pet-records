import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient, DocumentStatus, PetSpecies } from '@prisma/client';
import { parseVetRecordText } from '../src/ocr/mock-vet-record.parser';

const prisma = new PrismaClient();

const MINIMAL_PDF = `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 30 72 Td (Sample Pet Record) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000010 00000 n
0000000061 00000 n
0000000118 00000 n
0000000207 00000 n
trailer
<< /Root 1 0 R /Size 5 >>
startxref
301
%%EOF
`;

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
      name: 'Sample Household',
    },
  });

  const pet = await prisma.pet.create({
    data: {
      householdId: household.id,
      name: 'Alfred',
      species: PetSpecies.CAT,
      breed: 'Domestic Shorthair',
      sex: 'Male',
    },
  });

  const secondPet = await prisma.pet.create({
    data: {
      householdId: household.id,
      name: 'Milo',
      species: PetSpecies.DOG,
      breed: 'Labrador Mix',
      sex: 'Male',
    },
  });

  const clinic = await prisma.clinic.create({
    data: {
      name: 'Golden Corner Veterinary Hospital',
      address: '10445 Clemson Boulevard, Seneca, SC 29678',
      phone: '(864) 882-4488',
    },
  });

  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  mkdirSync(uploadDir, { recursive: true });
  const samplePdfPath = join(uploadDir, 'sample-pet-record.pdf');
  writeFileSync(samplePdfPath, MINIMAL_PDF, 'utf8');

  const document = await prisma.document.create({
    data: {
      householdId: household.id,
      petId: pet.id,
      clinicId: clinic.id,
      originalName: 'sample-pet-record.pdf',
      filePath: samplePdfPath,
      mimeType: 'application/pdf',
      ocrStatus: DocumentStatus.OCR_IN_PROGRESS,
    },
  });

  const rawText = readFileSync(join(process.cwd(), 'prisma/sample-record-ocr.txt'), 'utf8');
  const parsed = parseVetRecordText(rawText);

  await prisma.ocrPage.create({
    data: {
      documentId: document.id,
      pageNumber: 1,
      fullText: rawText,
      rawOcrJson: {
        provider: 'seed-mock',
      },
    },
  });

  if (parsed.extractedFields.length > 0) {
    await prisma.extractedField.createMany({
      data: parsed.extractedFields.map((field) => ({
        documentId: document.id,
        fieldName: field.fieldName,
        fieldValue: field.fieldValue,
        confidence: field.confidence,
        sourcePage: 1,
      })),
    });
  }

  const visitDate = parsed.visitDate || new Date();
  const visit = await prisma.visit.create({
    data: {
      documentId: document.id,
      petId: pet.id,
      clinicId: clinic.id,
      visitDate,
      printedAt: parsed.printedAt,
      invoiceNumber: parsed.invoiceNumber,
      accountNumber: parsed.accountNumber,
      totalCharges:
        parsed.totalCharges !== undefined ? new Prisma.Decimal(parsed.totalCharges) : undefined,
      totalPayments:
        parsed.totalPayments !== undefined ? new Prisma.Decimal(parsed.totalPayments) : undefined,
      balance: parsed.balance !== undefined ? new Prisma.Decimal(parsed.balance) : undefined,
    },
  });

  if (parsed.lineItems.length > 0) {
    await prisma.visitLineItem.createMany({
      data: parsed.lineItems.map((lineItem) => ({
        visitId: visit.id,
        serviceDate: lineItem.serviceDate,
        description: lineItem.description,
        totalPrice:
          lineItem.totalPrice !== undefined
            ? new Prisma.Decimal(lineItem.totalPrice)
            : undefined,
      })),
    });
  }

  if (parsed.reminders.length > 0) {
    await prisma.reminder.createMany({
      data: parsed.reminders.map((reminder) => ({
        petId: pet.id,
        visitId: visit.id,
        serviceName: reminder.serviceName,
        dueDate: reminder.dueDate,
        lastDoneDate: reminder.lastDoneDate,
      })),
    });
  }

  if (parsed.weightValue !== undefined) {
    await prisma.weightMeasurement.create({
      data: {
        petId: pet.id,
        visitId: visit.id,
        measuredAt: visitDate,
        weightValue: new Prisma.Decimal(parsed.weightValue),
        weightUnit: parsed.weightUnit || 'lbs',
        source: 'seed-parser',
      },
    });
  }

  await prisma.document.update({
    where: { id: document.id },
    data: {
      visitDate,
      ocrStatus: DocumentStatus.PARSE_COMPLETE,
      processedAt: new Date(),
    },
  });

  const dogDocument = await prisma.document.create({
    data: {
      householdId: household.id,
      petId: secondPet.id,
      clinicId: clinic.id,
      originalName: 'sample-dog-checkup.pdf',
      filePath: samplePdfPath,
      mimeType: 'application/pdf',
      visitDate: new Date(Date.UTC(2025, 10, 14)),
      ocrStatus: DocumentStatus.PARSE_COMPLETE,
      processedAt: new Date(),
    },
  });

  const dogVisit = await prisma.visit.create({
    data: {
      documentId: dogDocument.id,
      petId: secondPet.id,
      clinicId: clinic.id,
      visitDate: new Date(Date.UTC(2025, 10, 14)),
      invoiceNumber: '510008',
      accountNumber: '26262',
      totalCharges: new Prisma.Decimal(145.5),
      totalPayments: new Prisma.Decimal(145.5),
      balance: new Prisma.Decimal(0),
    },
  });

  await prisma.visitLineItem.createMany({
    data: [
      {
        visitId: dogVisit.id,
        serviceDate: new Date(Date.UTC(2025, 10, 14)),
        description: 'Canine Annual Wellness Exam',
        totalPrice: new Prisma.Decimal(82),
      },
      {
        visitId: dogVisit.id,
        serviceDate: new Date(Date.UTC(2025, 10, 14)),
        description: 'Bordetella Vaccine',
        totalPrice: new Prisma.Decimal(31),
      },
      {
        visitId: dogVisit.id,
        serviceDate: new Date(Date.UTC(2025, 10, 14)),
        description: 'Heartworm Test',
        totalPrice: new Prisma.Decimal(32.5),
      },
    ],
  });

  await prisma.weightMeasurement.createMany({
    data: [
      {
        petId: secondPet.id,
        visitId: dogVisit.id,
        measuredAt: new Date(Date.UTC(2025, 10, 14)),
        weightValue: new Prisma.Decimal(56.2),
        weightUnit: 'lbs',
        source: 'seed-parser',
      },
      {
        petId: secondPet.id,
        measuredAt: new Date(Date.UTC(2024, 10, 12)),
        weightValue: new Prisma.Decimal(53.8),
        weightUnit: 'lbs',
        source: 'seed-history',
      },
    ],
  });

  console.log('Seed complete');
  console.log(`householdId=${household.id}`);
  console.log(`petId=${pet.id}`);
  console.log(`secondPetId=${secondPet.id}`);
  console.log(`documentId=${document.id}`);
  console.log(`visitId=${visit.id}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
