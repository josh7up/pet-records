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
            <p>{new Date(visit.visitDate).toLocaleDateString()}</p>
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
