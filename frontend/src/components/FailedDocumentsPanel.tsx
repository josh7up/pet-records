import { useState } from 'react';
import { api } from '../api/client';
import type { DocumentRecord } from '../types/api';

interface FailedDocumentsPanelProps {
  documents: DocumentRecord[];
  onChanged: () => void;
}

export function FailedDocumentsPanel({ documents, onChanged }: FailedDocumentsPanelProps) {
  const [busyId, setBusyId] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  async function reprocess(documentId: string) {
    setBusyId(documentId);
    setMessage('');
    try {
      const result = await api.reprocessDocument(documentId);
      setMessage(result?.message || 'Reprocess started.');
      onChanged();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="panel">
      <h2>Failed uploads</h2>
      {!documents.length ? <p className="empty">No failed documents.</p> : null}
      {documents.length ? (
        <div className="failed-list">
          {documents.map((document) => (
            <div key={document.id} className="failed-item">
              <div>
                <strong>{document.originalName}</strong>
                <p>
                  Uploaded {new Date(document.uploadedAt).toLocaleString()} | Status:{' '}
                  {document.ocrStatus}
                </p>
              </div>
              <button
                className="primary"
                type="button"
                disabled={busyId === document.id}
                onClick={() => {
                  void reprocess(document.id);
                }}
              >
                {busyId === document.id ? 'Reprocessing...' : 'Retry OCR'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {message ? <p>{message}</p> : null}
    </section>
  );
}
