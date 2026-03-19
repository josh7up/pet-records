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

  return (
    <div className="results">
      {visits.map((visit) => (
        <button
          key={visit.id}
          className={`result-card ${selectedVisitId === visit.id ? 'selected' : ''}`}
          onClick={() => onSelect(visit)}
          type="button"
        >
          <div>
            <h3>{visit.pet.name}</h3>
            <p>{formatLocalDate(visit.visitDate)}</p>
          </div>
          <p>Invoice: {visit.invoiceNumber || 'n/a'}</p>
          <p>
            Services:{' '}
            {visit.lineItems.map((item) => item.description).slice(0, 2).join(', ') || 'n/a'}
          </p>
          <p>Status: {visit.document.ocrStatus}</p>
        </button>
      ))}
    </div>
  );
}
