import type { SearchVisit } from '../types/api';

interface SearchResultsProps {
  visits: SearchVisit[];
  selectedVisitId?: string;
  onSelect: (visit: SearchVisit) => void;
}

export function SearchResults({ visits, selectedVisitId, onSelect }: SearchResultsProps) {
  if (!visits.length) {
    return <p className="empty">No records found for this filter set.</p>;
  }

  const formatLocalDate = (value: string) => {
    const parts = value.slice(0, 10).split('-');
    if (parts.length !== 3) return value;
    const [year, month, day] = parts.map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString();
  };

  const grouped = new Map<string, { primary: SearchVisit; pets: string[]; services: string[] }>();
  for (const visit of visits) {
    const key = visit.document.id;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        primary: visit,
        pets: [visit.pet.name],
        services: visit.lineItems.map((item) => item.description),
      });
      continue;
    }
    existing.pets.push(visit.pet.name);
    existing.services.push(...visit.lineItems.map((item) => item.description));
  }

  const entries = Array.from(grouped.values()).map((entry) => ({
    ...entry,
    pets: Array.from(new Set(entry.pets)).filter(Boolean),
    services: Array.from(new Set(entry.services)).filter(Boolean),
  }));

  return (
    <div className="results">
      {entries.map((entry) => {
        const { primary } = entry;
        const isSelected = selectedVisitId === primary.id;
        return (
        <button
          key={primary.document.id}
          className={`result-card ${isSelected ? 'selected' : ''}`}
          onClick={() => onSelect(primary)}
          type="button"
        >
          <div>
            <h3 className="pet-names">{entry.pets.join(', ') || 'n/a'}</h3>
            <p>{formatLocalDate(primary.visitDate)}</p>
          </div>
          <p>Invoice: {primary.invoiceNumber || 'n/a'}</p>
          <p>
            Services:{' '}
            {entry.services.slice(0, 2).join(', ') || 'n/a'}
          </p>
        </button>
      )})}
    </div>
  );
}
