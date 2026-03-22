import { useEffect, useMemo, useState } from 'react';
import { api } from './api/client';
import { DocumentInspector } from './components/DocumentInspector';
import { PetSelector } from './components/PetSelector';
import { ReviewCandidatesPanel } from './components/ReviewCandidatesPanel';
import { SearchFilters, type SearchFilterState } from './components/SearchFilters';
import { SearchResults } from './components/SearchResults';
import { UploadRecordPanel } from './components/UploadRecordPanel';
import { WeightChartPanel } from './components/WeightChartPanel';
import type { Pet, SearchVisit, WeightPoint } from './types/api';

type PageId = 'upload' | 'search' | 'weight';

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
  const [pets, setPets] = useState<Pet[]>([]);
  const [selectedPetId, setSelectedPetId] = useState('');
  const [visits, setVisits] = useState<SearchVisit[]>([]);
  const [selectedVisit, setSelectedVisit] = useState<SearchVisit | undefined>();
  const [weightPoints, setWeightPoints] = useState<WeightPoint[]>([]);
  const [reviewDocuments, setReviewDocuments] = useState<
    Awaited<ReturnType<typeof api.documents>>['data']
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState('');
  const [page, setPage] = useState<PageId>('upload');

  const readVisitIdFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('visitId') || '';
  };

  const readTabFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'upload' || tab === 'search' || tab === 'weight') {
      return tab;
    }
    return '';
  };

  const setPageAndRoute = (nextPage: PageId, visitId?: string, replace = false) => {
    setPage(nextPage);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', nextPage);
    if (visitId) {
      url.searchParams.set('visitId', visitId);
    } else if (nextPage !== 'search') {
      url.searchParams.delete('visitId');
    }
    if (replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
  };

  const selectVisit = (visit?: SearchVisit, replace = false) => {
    setSelectedVisit(visit);
    if (visit?.id) {
      setPageAndRoute('search', visit.id, replace);
    } else {
      setPageAndRoute(page, undefined, replace);
    }
  };

  const selectedPet = useMemo(
    () => pets.find((pet) => pet.id === selectedPetId),
    [pets, selectedPetId],
  );

  async function loadBaseData() {
    try {
      const petRows = await api.pets('pageSize=100');
      setPets(petRows.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  async function loadReviewDocuments() {
    try {
      const reviewDocs = await api.documents('status=NEEDS_REVIEW&pageSize=50');
      setReviewDocuments(reviewDocs.data);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }

  useEffect(() => {
    void loadBaseData();
    void loadReviewDocuments();
    const urlVisitId = readVisitIdFromUrl();
    const urlTab = readTabFromUrl();
    if (urlTab) {
      setPage(urlTab);
    }
    if (urlVisitId && (!urlTab || urlTab === 'search')) {
      setPageAndRoute('search', urlVisitId, true);
      void (async () => {
        try {
          const data = await api.searchVisits('pageSize=100');
          const sorted = [...data.data].sort((a, b) => {
            const [ay, am, ad] = a.visitDate.slice(0, 10).split('-').map(Number);
            const [by, bm, bd] = b.visitDate.slice(0, 10).split('-').map(Number);
            const aKey = ay && am && ad ? new Date(ay, am - 1, ad).getTime() : 0;
            const bKey = by && bm && bd ? new Date(by, bm - 1, bd).getTime() : 0;
            return bKey - aKey;
          });
          setVisits(sorted);
          const match = sorted.find((visit) => visit.id === urlVisitId);
          if (match) {
            selectVisit(match, true);
            setSelectedPetId(match.pet.id);
          } else {
            selectVisit(sorted[0], true);
          }
        } catch (loadError) {
          setError((loadError as Error).message);
        }
      })();
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const visitId = params.get('visitId') || '';
      if (tab === 'upload' || tab === 'search' || tab === 'weight') {
        setPage(tab);
      }
      if (visitId) {
        const match = visits.find((visit) => visit.id === visitId);
        if (match) {
          setSelectedVisit(match);
          setSelectedPetId(match.pet.id);
        }
      } else if (tab !== 'search') {
        setSelectedVisit(undefined);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [visits]);

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
      const sorted = [...data.data].sort((a, b) => {
        const [ay, am, ad] = a.visitDate.slice(0, 10).split('-').map(Number);
        const [by, bm, bd] = b.visitDate.slice(0, 10).split('-').map(Number);
        const aKey = ay && am && ad ? new Date(ay, am - 1, ad).getTime() : 0;
        const bKey = by && bm && bd ? new Date(by, bm - 1, bd).getTime() : 0;
        return bKey - aKey;
      });
      setVisits(sorted);
      const urlVisitId = readVisitIdFromUrl();
      const nextSelected = urlVisitId ? sorted.find((visit) => visit.id === urlVisitId) : sorted[0];
      selectVisit(nextSelected);
      if (filters.petId) {
        setSelectedPetId(filters.petId);
      }
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAfterUpload(navigateToSearch = true) {
    await loadBaseData();
    await loadReviewDocuments();
    if (!navigateToSearch) {
      return;
    }
    try {
      const data = await api.searchVisits('pageSize=50');
      const sorted = [...data.data].sort((a, b) => {
        const [ay, am, ad] = a.visitDate.slice(0, 10).split('-').map(Number);
        const [by, bm, bd] = b.visitDate.slice(0, 10).split('-').map(Number);
        const aKey = ay && am && ad ? new Date(ay, am - 1, ad).getTime() : 0;
        const bKey = by && bm && bd ? new Date(by, bm - 1, bd).getTime() : 0;
        return bKey - aKey;
      });
      setVisits(sorted);
      const urlVisitId = readVisitIdFromUrl();
      const nextSelected = urlVisitId ? sorted.find((visit) => visit.id === urlVisitId) : sorted[0];
      selectVisit(nextSelected);
    } catch (searchError) {
      setError((searchError as Error).message);
    }
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => {
      setToast('');
    }, 2500);
  }

  return (
    <main className="layout">
      <header>
        <h1>Pet Record Management</h1>
        <p>Pets: {pets.length}</p>
      </header>

      <section className="page-tabs">
        <button
          type="button"
          className={`tab-btn ${page === 'upload' ? 'active' : ''}`}
          onClick={() => setPageAndRoute('upload')}
        >
          Upload record
        </button>
        <button
          type="button"
          className={`tab-btn ${page === 'search' ? 'active' : ''}`}
          onClick={() => setPageAndRoute('search')}
        >
          Search records
        </button>
        <button
          type="button"
          className={`tab-btn ${page === 'weight' ? 'active' : ''}`}
          onClick={() => setPageAndRoute('weight')}
        >
          Weight trend
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p>Loading...</p> : null}

      {page === 'upload' ? (
        <>
          <UploadRecordPanel
            onUploaded={() => {
              void refreshAfterUpload(false);
            }}
          />

          <ReviewCandidatesPanel
            documents={reviewDocuments}
            pets={pets}
            onChanged={() => {
              void refreshAfterUpload();
            }}
          />
        </>
      ) : null}

      {page === 'search' ? (
        <>
          <section className="panel">
            <h2>Search records</h2>
            <SearchFilters
              pets={pets}
              initialState={{ petId: selectedPetId }}
              onApply={applySearch}
            />
          </section>

          <section className="panel">
            <h2>Results</h2>
            <SearchResults
              visits={visits}
              selectedVisitId={selectedVisit?.id}
              onSelect={(visit) => {
                selectVisit(visit);
                setSelectedPetId(visit.pet.id);
              }}
            />
          </section>

          <DocumentInspector
            visit={selectedVisit}
            onDeleted={(deletedDocumentId) => {
              setSelectedVisit(undefined);
              setVisits((prev) => prev.filter((visit) => visit.document.id !== deletedDocumentId));
              void refreshAfterUpload();
              showToast('Record deleted.');
            }}
          />
        </>
      ) : null}

      {page === 'weight' ? (
        <>
          <section className="panel">
            <h2>Weight trend</h2>
            <PetSelector
              pets={pets}
              selectedPetId={selectedPetId}
              onChange={(petId) => setSelectedPetId(petId)}
            />
          </section>
          <WeightChartPanel pet={selectedPet} points={weightPoints} />
        </>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}
