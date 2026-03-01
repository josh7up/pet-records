import { useState } from 'react';
import { api } from '../api/client';
import type { SearchVisit } from '../types/api';

interface DocumentInspectorProps {
  visit?: SearchVisit;
  onDeleted: (documentId: string) => void;
}

export function DocumentInspector({ visit, onDeleted }: DocumentInspectorProps) {
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!visit) {
    return <p className="empty">Select a search result to inspect OCR and source PDF.</p>;
  }

  const activeVisit = visit;
  const fileUrl = `${api.baseUrl}/documents/${activeVisit.document.id}/file`;

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete record "${activeVisit.invoiceNumber || activeVisit.document.originalName}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      setMessage('');
      await api.deleteDocument(activeVisit.document.id);
      setMessage('Record deleted.');
      onDeleted(activeVisit.document.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="panel two-col">
      <div>
        <div className="inspector-head">
          <h2>Scanned document</h2>
          <button className="danger" type="button" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete record'}
          </button>
        </div>
        <iframe src={fileUrl} title="Scanned pet record" className="pdf-frame" />
      </div>
      <div>
        <h2>OCR + parsed fields</h2>
        <ul className="fields">
          {visit.document.extractedFields.map((field) => (
            <li key={field.id}>
              <strong>{field.fieldName}:</strong> {field.fieldValue}
            </li>
          ))}
        </ul>
        <pre className="ocr-text">
          {visit.document.pages.map((page) => page.fullText).join('\n\n') ||
            'No OCR text available'}
        </pre>
        {message ? <p className="error">{message}</p> : null}
      </div>
    </section>
  );
}
