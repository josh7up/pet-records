import { useEffect, useMemo, useState } from 'react';
import { api } from './api/client';
import { DocumentInspector } from './components/DocumentInspector';
import { FailedDocumentsPanel } from './components/FailedDocumentsPanel';
import { ReviewCandidatesPanel } from './components/ReviewCandidatesPanel';
import { SearchFilters, type SearchFilterState } from './components/SearchFilters';
import { SearchResults } from './components/SearchResults';
import { UploadRecordPanel } from './components/UploadRecordPanel';
import { WeightChartPanel } from './components/WeightChartPanel';
import type { DocumentRecord, Household, Pet, SearchVisit, WeightPoint } from './types/api';

function toQueryString(filters: SearchFilterState) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  params.set('pageSize', '50');
  return params.toString();
}

export function App() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPetId, setSelectedPetId] = useState('');
  const [visits, setVisits] = useState<SearchVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<SearchVisit | undefined>();
  const [weightPoints, setWeightPoints] = useState<WeightPoint[]>([]);
  const [failedDocuments, setFailedDocuments] = useState<DocumentRecord[]>([]);
  const [reviewDocuments, setReviewDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId),
    [pets, selectedPetId],
  );

  async function loadBaseData() {
    try {
      const [householdRows, petRows] = await Promise.all([
        api.households(),
        api.pets('pageSize=100'),
      ]);
      setHouseholds(householdRows);
      setPets(petRows.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  async function loadFailedDocuments() {
    try {
      const docs = await api.documents('status=FAILED&pageSize=50');
      setFailedDocuments(docs.data);
      const reviewDocs = await api.documents('status=NEEDS_REVIEW&pageSize=50');
      setReviewDocuments(reviewDocs.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  useEffect(() => {
    void loadBaseData();
    void loadFailedDocuments();
  }, []);

  useEffect(() => {
    if (!selectedPetId) {
      setWeightPoints([]);
      return;
    }

    void (async () => {
      try {
        const data = await api.weightSeries(selectedPetId);
        setWeightPoints(data.points);
      } catch (loadError) {
        setError((loadError as Error).message);
      }
    })();
  }, [selectedPetId]);

  async function applySearch(filters: SearchFilterState) {
    setLoading(true);
    setError('');

    try {
      const query = toQueryString(filters);
      const data = await api.searchVisits(query);
      setVisits(data.data);
      setSelectedVisit(data.data[0]);
      if (filters.petId) {
        setSelectedPetId(filters.petId);
      }
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAfterUpload() {
    await loadBaseData();
    await loadFailedDocuments();
    try {
      const data = await api.searchVisits('pageSize=50');
      setVisits(data.data);
      setSelectedVisit(data.data[0]);
    } catch (searchError) {
      setError((searchError as Error).message);
    }
  }

  return (
    <main className="layout">
      <header>
        <h1>Pet Record Management</h1>
        <p>
          Households: {households.length} | Pets: {pets.length}
        </p>
      </header>

      <UploadRecordPanel
        households={households}
        pets={pets}
        onUploaded={() => {
          void refreshAfterUpload();
        }}
      />

      <FailedDocumentsPanel
        documents={failedDocuments}
        onChanged={() => {
          void refreshAfterUpload();
        }}
      />

      <ReviewCandidatesPanel
        documents={reviewDocuments}
        pets={pets}
        onChanged={() => {
          void refreshAfterUpload();
        }}
      />

      <section className="panel">
        <h2>Search records</h2>
        <SearchFilters
          pets={pets}
          initialState={{ petId: selectedPetId }}
          onApply={applySearch}
        />
      </section>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p>Loading...</p> : null}

      <section className="panel">
        <h2>Results</h2>
        <SearchResults
          visits={visits}
          selectedVisitId={selectedVisit?.id}
          onSelect={(visit) => {
            setSelectedVisit(visit);
            setSelectedPetId(visit.pet.id);
          }}
        />
      </section>

      <DocumentInspector visit={selectedVisit} />
      <WeightChartPanel pet={selectedPet} points={weightPoints} />
    </main>
  );
}
