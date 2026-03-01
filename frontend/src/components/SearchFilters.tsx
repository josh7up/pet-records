import { FormEvent, useState } from 'react';
import type { Pet } from '../types/api';
import { PetSelector } from './PetSelector';

export interface SearchFilterState {
  petId: string;
  petName: string;
  service: string;
  clinicName: string;
  invoiceNumber: string;
  dateFrom: string;
  dateTo: string;
  text: string;
}

interface SearchFiltersProps {
  pets: Pet[];
  initialState?: Partial<SearchFilterState>;
  onApply: (filters: SearchFilterState) => void;
}

const initialFilters: SearchFilterState = {
  petId: '',
  petName: '',
  service: '',
  clinicName: '',
  invoiceNumber: '',
  dateFrom: '',
  dateTo: '',
  text: '',
};

export function SearchFilters({ pets, initialState, onApply }: SearchFiltersProps) {
  const [filters, setFilters] = useState<SearchFilterState>({
    ...initialFilters,
    ...initialState,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(filters);
  }

  return (
    <form className="grid" onSubmit={submit}>
      <PetSelector
        pets={pets}
        selectedPetId={filters.petId}
        onChange={(petId) => setFilters((prev) => ({ ...prev, petId }))}
      />

      <label className="field">
        Pet name
        <input
          value={filters.petName}
          onChange={(event) => setFilters((prev) => ({ ...prev, petName: event.target.value }))}
          placeholder="Alfred"
        />
      </label>

      <label className="field">
        Service
        <input
          value={filters.service}
          onChange={(event) => setFilters((prev) => ({ ...prev, service: event.target.value }))}
          placeholder="Rabies"
        />
      </label>

      <label className="field">
        Clinic
        <input
          value={filters.clinicName}
          onChange={(event) => setFilters((prev) => ({ ...prev, clinicName: event.target.value }))}
          placeholder="Golden Corner"
        />
      </label>

      <label className="field">
        Invoice #
        <input
          value={filters.invoiceNumber}
          onChange={(event) =>
            setFilters((prev) => ({ ...prev, invoiceNumber: event.target.value }))
          }
          placeholder="414145"
        />
      </label>

      <label className="field">
        Visit from
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(event) => setFilters((prev) => ({ ...prev, dateFrom: event.target.value }))}
        />
      </label>

      <label className="field">
        Visit to
        <input
          type="date"
          value={filters.dateTo}
          onChange={(event) => setFilters((prev) => ({ ...prev, dateTo: event.target.value }))}
        />
      </label>

      <label className="field full">
        OCR text search
        <input
          value={filters.text}
          onChange={(event) => setFilters((prev) => ({ ...prev, text: event.target.value }))}
          placeholder="Purevax"
        />
      </label>

      <button className="primary" type="submit">
        Search records
      </button>
    </form>
  );
}
