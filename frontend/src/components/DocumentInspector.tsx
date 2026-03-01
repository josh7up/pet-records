import { api } from '../api/client';
import type { SearchVisit } from '../types/api';

interface DocumentInspectorProps {
  visit?: SearchVisit;
}

export function DocumentInspector({ visit }: DocumentInspectorProps) {
  if (!visit) {
    return <p className="empty">Select a search result to inspect OCR and source PDF.</p>;
  }

  const fileUrl = `${api.baseUrl}/documents/${visit.document.id}/file`;

  return (
    <section className="panel two-col">
      <div>
        <h2>Scanned document</h2>
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
      </div>
    </section>
  );
}
