import { useState } from 'react';
import { api } from '../api/client';
import type { DocumentRecord, Pet } from '../types/api';

type Action = 'create' | 'link' | 'reject';

interface CandidateDecisionState {
  action: Action;
  petId: string;
  petName: string;
}

interface ReviewCandidatesPanelProps {
  documents: DocumentRecord[];
  pets: Pet[];
  onChanged: () => void;
}

export function ReviewCandidatesPanel({ documents, pets, onChanged }: ReviewCandidatesPanelProps) {
  const [state, setState] = useState<Record<string, CandidateDecisionState>>({});
  const [busyDocId, setBusyDocId] = useState('');
  const [busyAction, setBusyAction] = useState<'apply' | 'cancel' | ''>('');
  const [message, setMessage] = useState('');

  function decisionKey(documentId: string, candidateId: string) {
    return `${documentId}:${candidateId}`;
  }

  async function submitDocument(document: DocumentRecord) {
    const decisions = document.petCandidates
      .filter((candidate) => candidate.status === 'PENDING')
      .map((candidate) => {
        const key = decisionKey(document.id, candidate.id);
        const current = state[key] || {
          action: 'create' as Action,
          petId: '',
          petName: candidate.detectedName,
        };

        return {
          candidateId: candidate.id,
          action: current.action,
          petId: current.action === 'link' ? current.petId : undefined,
          petName: current.action === 'create' ? current.petName : undefined,
        };
      });

    if (decisions.some((decision) => decision.action === 'link' && !decision.petId)) {
      setMessage('Select a pet for all link decisions.');
      return;
    }

    setBusyDocId(document.id);
    setBusyAction('apply');
    setMessage('');
    try {
      await api.reviewPets(document.id, { decisions });
      setMessage('Pet review saved and document updated.');
      onChanged();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusyDocId('');
      setBusyAction('');
    }
  }

  async function cancelDocument(document: DocumentRecord) {
    const confirmed = window.confirm(
      `Cancel upload for "${document.originalName}"? This will delete the document.`,
    );
    if (!confirmed) {
      return;
    }

    setBusyDocId(document.id);
    setBusyAction('cancel');
    setMessage('');
    try {
      await api.deleteDocument(document.id);
      setMessage('Upload canceled and document removed.');
      onChanged();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusyDocId('');
      setBusyAction('');
    }
  }

  return (
    <section className="panel">
      <h2>Pet review required</h2>
      {!documents.length ? <p className="empty">No documents waiting for pet review.</p> : null}
      {documents.map((document) => {
        const pendingCandidates = document.petCandidates.filter(
          (candidate) => candidate.status === 'PENDING',
        );

        return (
          <div key={document.id} className="review-doc">
            <h3>{document.originalName}</h3>
            {pendingCandidates.map((candidate) => {
              const key = decisionKey(document.id, candidate.id);
              const current = state[key] || {
                action: 'create' as Action,
                petId: '',
                petName: candidate.detectedName,
              };

              return (
                <div key={candidate.id} className="review-row">
                  <strong>Detected: {candidate.detectedName}</strong>
                  <select
                    value={current.action}
                    onChange={(event) => {
                      const action = event.target.value as Action;
                      setState((prev) => ({
                        ...prev,
                        [key]: {
                          ...current,
                          action,
                        },
                      }));
                    }}
                  >
                    <option value="create">Create new pet</option>
                    <option value="link">Link to existing pet</option>
                    <option value="reject">Ignore candidate</option>
                  </select>

                  {current.action === 'link' ? (
                    <select
                      value={current.petId}
                      onChange={(event) => {
                        setState((prev) => ({
                          ...prev,
                          [key]: {
                            ...current,
                            petId: event.target.value,
                          },
                        }));
                      }}
                    >
                      <option value="">Select pet</option>
                      {pets.map((pet) => (
                        <option key={pet.id} value={pet.id}>
                          {pet.name} {pet.species !== 'OTHER' ? ` (${pet.species})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {current.action === 'create' ? (
                    <input
                      value={current.petName}
                      onChange={(event) => {
                        setState((prev) => ({
                          ...prev,
                          [key]: {
                            ...current,
                            petName: event.target.value,
                          },
                        }));
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            <div className="review-actions">
              <button
                className="primary"
                type="button"
                disabled={busyDocId === document.id}
                onClick={() => {
                  void submitDocument(document);
                }}
              >
                {busyDocId === document.id && busyAction === 'apply'
                  ? 'Applying...'
                  : 'Apply review'}
              </button>
              <button
                className="danger"
                type="button"
                disabled={busyDocId === document.id}
                onClick={() => {
                  void cancelDocument(document);
                }}
              >
                {busyDocId === document.id && busyAction === 'cancel'
                  ? 'Canceling...'
                  : 'Cancel upload'}
              </button>
            </div>
          </div>
        );
      })}
      {message ? <p>{message}</p> : null}
    </section>
  );
}
