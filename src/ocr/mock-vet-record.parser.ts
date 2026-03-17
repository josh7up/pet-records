export interface ParsedLineItem {
  serviceDate?: Date;
  description: string;
  totalPrice?: number;
}

export interface ParsedReminder {
  dueDate?: Date;
  serviceName: string;
  lastDoneDate?: Date;
}

export interface ParsedPetSection {
  petName: string;
  totalCharges?: number;
  weightValue?: number;
  weightUnit?: string;
  lineItems: ParsedLineItem[];
  reminders: ParsedReminder[];
}

export interface ParsedVetRecord {
  clinicName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  printedAt?: Date;
  visitDate?: Date;
  accountNumber?: string;
  invoiceNumber?: string;
  petName?: string;
  totalCharges?: number;
  totalPayments?: number;
  balance?: number;
  weightValue?: number;
  weightUnit?: string;
  lineItems: ParsedLineItem[];
  reminders: ParsedReminder[];
  petSections: ParsedPetSection[];
  extractedFields: { fieldName: string; fieldValue: string; confidence?: number }[];
}

function parseTwoDigitYearDate(value: string): Date | undefined {
  const match = value.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (!match) {
    return undefined;
  }

  const [, mm, dd, yy] = match;
  const year = Number(yy) < 70 ? Number(`20${yy}`) : Number(`19${yy}`);
  return new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
}

function parseAmount(value: string): number | undefined {
  const normalized = value.replace(/[^0-9.-]/g, '');
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function parsePrintedDate(value: string): Date | undefined {
  const dateMatch = value.match(/(\d{2}-\d{2}-\d{2})/);
  if (!dateMatch) {
    return undefined;
  }
  return parseTwoDigitYearDate(dateMatch[1]);
}

function normalizePetName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractNameAmountPairs(line: string): Array<{ name: string; amountText: string }> {
  const pairs: Array<{ name: string; amountText: string }> = [];
  const regex = /([A-Za-z][A-Za-z' -]{0,30})\s+(-?\d+\.\d{2})/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(line)) !== null) {
    pairs.push({ name: match[1].trim(), amountText: match[2] });
  }
  return pairs;
}

function maybePetName(value: string): boolean {
  return /^[A-Za-z][A-Za-z' -]{0,30}$/.test(value.trim());
}

function isNonPetToken(value: string): boolean {
  return /^(date|for|qty|description|price|discount|invoice|account|printed|charges|payments|balance|old|new|visa|payment|total)$/i.test(
    value.trim(),
  );
}

function isNumericSummaryText(value: string): boolean {
  const trimmed = value.trim();
  return /^-?\d+\.\d{2}(?:\s+-?\d+\.\d{2})+$/.test(trimmed);
}

function isLikelyServiceDescription(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (isNumericSummaryText(trimmed)) {
    return false;
  }
  return /[A-Za-z]/.test(trimmed);
}

export function parseVetRecordText(rawText: string): ParsedVetRecord {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsePaymentsFromBalanceSummary = () => {
    const headerIndex = lines.findIndex((line) =>
      /old\s+balance\s+charges\s+payments\s+new\s+balance/i.test(line),
    );
    if (headerIndex < 0) {
      return undefined;
    }

    for (let index = headerIndex + 1; index < Math.min(lines.length, headerIndex + 8); index += 1) {
      const line = lines[index];
      if (/^patient\b|^reminders?\s+for:/i.test(line)) {
        break;
      }
      const amounts = line.match(/-?\d+\.\d{2}/g);
      if (!amounts || amounts.length < 4) {
        continue;
      }
      const parsed = Number(amounts[2]);
      if (Number.isFinite(parsed)) {
        return Math.abs(parsed);
      }
    }

    return undefined;
  };

  const clinicName = lines.find((line) => line.toLowerCase().includes('veterinary'));
  const clinicPhone = lines.find((line) => /\(\d{3}\)\s*\d{3}-\d{4}/.test(line));
  const clinicNameIndex = clinicName ? lines.findIndex((line) => line === clinicName) : -1;
  const clinicAddress =
    clinicNameIndex >= 0 && clinicNameIndex + 2 < lines.length
      ? `${lines[clinicNameIndex + 1]} ${lines[clinicNameIndex + 2]}`
      : undefined;

  const dateLine = lines.find((line) => /^Date:\s*/i.test(line));
  const printedLine = lines.find((line) => /^Printed:\s*/i.test(line));
  const accountLine = lines.find((line) => /^Account:\s*/i.test(line));
  const invoiceLine = lines.find((line) => /^Invoice:\s*/i.test(line));
  const chargesMatch = lines.find((line) => /^Charges\s+/i.test(line));
  const paymentsMatch = lines.find((line) => /^Payments\s+/i.test(line));
  const balanceMatch = lines.find((line) => /^New balance\s+/i.test(line));
  const paymentsFromBalanceSummary = parsePaymentsFromBalanceSummary();

  const sections = new Map<string, ParsedPetSection>();
  const knownPetNames = new Set<string>();
  const ensureSection = (petName: string) => {
    const normalizedName = normalizePetName(petName);
    knownPetNames.add(normalizedName);
    if (!sections.has(normalizedName)) {
      sections.set(normalizedName, {
        petName: normalizedName,
        lineItems: [],
        reminders: [],
      });
    }
    return sections.get(normalizedName)!;
  };

  let activePet: string | undefined;
  let paymentAmount = 0;

  let insidePatientBlock = false;
  for (const line of lines) {
    if (/^Patient\b/i.test(line)) {
      insidePatientBlock = true;
      continue;
    }
    if (insidePatientBlock && /^Reminders\s+for:/i.test(line)) {
      insidePatientBlock = false;
    }

    const dateWithPetOnly = line.match(/^(\d{2}-\d{2}-\d{2})\s+([A-Za-z][A-Za-z' -]{0,30})$/);
    if (dateWithPetOnly) {
      knownPetNames.add(normalizePetName(dateWithPetOnly[2]));
    }
    const reminderHeader = line.match(
      /^Reminders\s+for:\s*([A-Za-z][A-Za-z' -]{0,30})\s*\(Weight:/i,
    );
    if (reminderHeader) {
      const candidateName = normalizePetName(reminderHeader[1]);
      if (knownPetNames.has(candidateName)) {
        knownPetNames.add(candidateName);
      }
    }
    if (insidePatientBlock) {
      const patientTotalLine = line.match(/^([A-Za-z][A-Za-z' -]{0,30})\s+(-?\d+\.\d{2})$/);
      if (
        patientTotalLine &&
        !/^(Old balance|Charges|Payments|New balance|Total charges)$/i.test(patientTotalLine[1])
      ) {
        knownPetNames.add(normalizePetName(patientTotalLine[1]));
      } else {
        for (const pair of extractNameAmountPairs(line)) {
          if (!/^(Old balance|Charges|Payments|New balance|Total charges)$/i.test(pair.name)) {
            knownPetNames.add(normalizePetName(pair.name));
          }
        }
      }
    }
  }

  let insidePatientTotals = false;
  for (const line of lines) {
    if (/^Patient\b/i.test(line)) {
      insidePatientTotals = true;
      continue;
    }
    if (insidePatientTotals && /^Reminders\s+for:/i.test(line)) {
      insidePatientTotals = false;
    }

    const dateWithPetOnly = line.match(/^(\d{2}-\d{2}-\d{2})\s+([A-Za-z][A-Za-z' -]{0,30})$/);
    if (dateWithPetOnly) {
      activePet = normalizePetName(dateWithPetOnly[2]);
      ensureSection(activePet);
      continue;
    }

    const datedLineItem = line.match(/^(\d{2}-\d{2}-\d{2})\s+(.+?)\s+(-?\d+\.\d{2})$/);
    if (datedLineItem) {
      const [, serviceDateText, bodyText, amountText] = datedLineItem;
      const serviceDate = parseTwoDigitYearDate(serviceDateText);
      const amount = parseAmount(amountText);

      const isPaymentRow = /payment/i.test(bodyText);
      if (isPaymentRow) {
        paymentAmount += Math.abs(amount || 0);
        continue;
      }

      let descriptionValue = bodyText;
      let derivedPet = activePet;

      const matchingKnownName = Array.from(knownPetNames).find((petName) =>
        new RegExp(`^${petName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+|$)`, 'i').test(
          bodyText,
        ),
      );
      if (matchingKnownName) {
        derivedPet = matchingKnownName;
        activePet = matchingKnownName;
        ensureSection(matchingKnownName);
        descriptionValue = bodyText
          .replace(new RegExp(`^${matchingKnownName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
          .trim();
      }
      if (!derivedPet && knownPetNames.size === 1) {
        derivedPet = Array.from(knownPetNames)[0];
      }

      if (derivedPet && isLikelyServiceDescription(descriptionValue)) {
        const section = ensureSection(derivedPet);
        section.lineItems.push({
          serviceDate,
          description: descriptionValue,
          totalPrice: amount,
        });
      }
      continue;
    }

    const looseLineItemMatch = line.match(/^(.+?)\s+(-?\d+\.\d{2})$/);
    if (
      !insidePatientTotals &&
      looseLineItemMatch &&
      !/^Old balance|^Charges|^Payments|^New balance|^Total charges|^Printed:|^Date:|^Account:|^Invoice:/i.test(line)
    ) {
      const [, description, amountText] = looseLineItemMatch;
      const amount = parseAmount(amountText);
      if (/payment/i.test(description)) {
        paymentAmount += Math.abs(amount || 0);
        continue;
      }

      if (activePet && isLikelyServiceDescription(description)) {
        const section = ensureSection(activePet);
        section.lineItems.push({
          description,
          totalPrice: amount,
        });
      }
    }
  }

  const patientIndex = lines.findIndex((line) => /^Patient\b/i.test(line));
  if (patientIndex >= 0) {
    for (let index = patientIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^Reminders\s+for:/i.test(line)) {
        break;
      }

      const totalLine = line.match(/^([A-Za-z][A-Za-z' -]{0,30})\s+(-?\d+\.\d{2})$/);
      if (totalLine) {
        const [, petName, totalText] = totalLine;
        const section = ensureSection(petName);
        section.totalCharges = parseAmount(totalText);
        continue;
      }

      const pairs = extractNameAmountPairs(line);
      if (pairs.length > 1) {
        for (const pair of pairs) {
          if (/^(Old balance|Charges|Payments|New balance|Total charges)$/i.test(pair.name)) {
            continue;
          }
          const section = ensureSection(pair.name);
          section.totalCharges = parseAmount(pair.amountText);
        }
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const reminderHeader = lines[index].match(
      /^Reminders\s+for:\s*([A-Za-z][A-Za-z' -]{0,30})\s*\(Weight:\s*([0-9.]+)\s*([a-zA-Z]+)/i,
    );
    if (!reminderHeader) {
      continue;
    }

    const [, petNameRaw, weightRaw, unitRaw] = reminderHeader;
    const petName = normalizePetName(petNameRaw);
    if (!knownPetNames.has(petName)) {
      continue;
    }
    const section = ensureSection(petName);
    section.weightValue = Number(weightRaw);
    section.weightUnit = unitRaw;

    for (let reminderIndex = index + 1; reminderIndex < lines.length; reminderIndex += 1) {
      const reminderLine = lines[reminderIndex];
      if (/^Reminders\s+for:/i.test(reminderLine)) {
        break;
      }

      const reminderMatch = reminderLine.match(
        /^(\d{2}-\d{2}-\d{2})\s+(.+?)\s+(\d{2}-\d{2}-\d{2})$/,
      );
      if (!reminderMatch) {
        continue;
      }

      const [, dueDateText, serviceName, lastDoneText] = reminderMatch;
      section.reminders.push({
        dueDate: parseTwoDigitYearDate(dueDateText),
        serviceName,
        lastDoneDate: parseTwoDigitYearDate(lastDoneText),
      });
    }
  }

  for (const section of sections.values()) {
    if (section.totalCharges === undefined) {
      section.totalCharges = section.lineItems.reduce(
        (sum, item) => sum + (item.totalPrice || 0),
        0,
      );
    }
  }

  const petSections = Array.from(sections.values());
  const allLineItems = petSections.flatMap((section) => section.lineItems);
  const allReminders = petSections.flatMap((section) => section.reminders);
  const firstSection = petSections[0];

  const parsed: ParsedVetRecord = {
    clinicName,
    clinicAddress,
    clinicPhone,
    printedAt: printedLine ? parsePrintedDate(printedLine) : undefined,
    visitDate: dateLine ? parseTwoDigitYearDate(dateLine.replace(/^Date:\s*/i, '')) : undefined,
    accountNumber: accountLine?.replace(/^Account:\s*/i, '').trim(),
    invoiceNumber: invoiceLine?.replace(/^Invoice:\s*/i, '').trim(),
    petName: firstSection?.petName,
    totalCharges: firstSection?.totalCharges,
    totalPayments: (() => {
      const fromSummary = paymentsFromBalanceSummary;
      const fromPaymentsLine = paymentsMatch
        ? Math.abs(parseAmount(paymentsMatch) || 0) || undefined
        : undefined;
      const fromPaymentRows = paymentAmount || undefined;
      return fromSummary ?? fromPaymentsLine ?? fromPaymentRows;
    })(),
    balance: balanceMatch ? parseAmount(balanceMatch) : undefined,
    weightValue: firstSection?.weightValue,
    weightUnit: firstSection?.weightUnit,
    lineItems: allLineItems,
    reminders: allReminders,
    petSections,
    extractedFields: [],
  };

  const extractedFields: ParsedVetRecord['extractedFields'] = [
    parsed.visitDate
      ? { fieldName: 'visit_date', fieldValue: parsed.visitDate.toISOString(), confidence: 0.95 }
      : undefined,
    parsed.invoiceNumber
      ? {
          fieldName: 'invoice_number',
          fieldValue: parsed.invoiceNumber,
          confidence: 0.94,
        }
      : undefined,
    parsed.accountNumber
      ? {
          fieldName: 'account_number',
          fieldValue: parsed.accountNumber,
          confidence: 0.93,
        }
      : undefined,
    petSections.length
      ? {
          fieldName: 'pet_names',
          fieldValue: petSections.map((section) => section.petName).join(', '),
          confidence: 0.9,
        }
      : undefined,
    petSections.length
      ? {
          fieldName: 'pet_count',
          fieldValue: String(petSections.length),
          confidence: 0.9,
        }
      : undefined,
  ].filter((field): field is NonNullable<typeof field> => Boolean(field));

  parsed.extractedFields = extractedFields;
  return parsed;
}
