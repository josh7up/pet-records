import { FormEvent, useState } from 'react';
import { api } from '../api/client';
import type { DocumentRecord } from '../types/api';

type UploadMode = 'single' | 'images';

interface UploadRecordPanelProps {
  onUploaded: () => void;
}

export function UploadRecordPanel({ onUploaded }: UploadRecordPanelProps) {
  const [mode, setMode] = useState<UploadMode>('single');
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [ocrPageCount, setOcrPageCount] = useState('');
  const [status, setStatus] = useState('');
  const [uploadSummary, setUploadSummary] = useState<{
    visitDate?: string;
    invoiceNumber?: string | null;
    petNames: string[];
    visitIds: string[];
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const formatDate = (value?: string | null) => {
    if (!value) return 'n/a';
    const raw = value.slice(0, 10);
    const [year, month, day] = raw.split('-');
    if (year && month && day) {
      return `${month}/${day}/${year}`;
    }
    return raw;
  };

  const buildSummary = (document: DocumentRecord) => {
    const visits = document.visits || [];
    const petNames = Array.from(new Set(visits.map((visit) => visit.pet.name))).filter(Boolean);
    return {
      visitDate: visits[0]?.visitDate,
      invoiceNumber: visits[0]?.invoiceNumber ?? null,
      petNames,
      visitIds: visits.map((visit) => visit.id),
    };
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('');
    setUploadSummary(null);

    try {
      setSubmitting(true);
      const payload: { ocrPageCount?: number } = {};
      if (mode === 'images' && ocrPageCount.trim()) {
        const count = Number(ocrPageCount);
        if (!Number.isNaN(count) && count > 0) {
          payload.ocrPageCount = count;
        }
      }

      if (mode === 'single') {
        if (!singleFile) {
          setStatus('Choose a PDF or image file.');
          return;
        }
        const result = await api.uploadDocument(singleFile, payload);
        const message = result?.ocr?.message || 'Upload complete.';
        const isFailed = result?.ocr?.status === 'failed';
        setStatus(message);
        if (!isFailed) {
          const details = await api.document(result.document.id);
          setUploadSummary(buildSummary(details));
          onUploaded();
        }
        setSingleFile(null);
        setImageFiles([]);
        setOcrPageCount('');
        return;
      } else {
        if (!imageFiles.length) {
          setStatus('Choose one or more JPG/PNG files.');
          return;
        }
        const result = await api.uploadDocumentImages(imageFiles, payload);
        const message = result?.ocr?.message || 'Upload complete.';
        const isFailed = result?.ocr?.status === 'failed';
        setStatus(message);
        if (!isFailed) {
          const details = await api.document(result.document.id);
          setUploadSummary(buildSummary(details));
          onUploaded();
        }
        setSingleFile(null);
        setImageFiles([]);
        setOcrPageCount('');
        return;
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <h2>Upload record</h2>
      <form className="stacked" onSubmit={submit}>
        <label className="field">
          Upload mode
          <select value={mode} onChange={(event) => setMode(event.target.value as UploadMode)}>
            <option value="single">Single PDF/image</option>
            <option value="images">Multiple images as one record</option>
          </select>
        </label>

        {mode === 'single' ? (
          <label className="field full">
            PDF or image
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(event) => setSingleFile(event.target.files?.[0] || null)}
            />
          </label>
        ) : (
          <>
            <label className="field full">
              Record pages (JPG/PNG)
              <input
                type="file"
                accept="image/png,image/jpeg"
                multiple
                onChange={(event) => setImageFiles(Array.from(event.target.files || []))}
              />
            </label>
            <label className="field">
              Pages to OCR
              <input
                type="number"
                min={1}
                max={25}
                placeholder="All pages"
                value={ocrPageCount}
                onChange={(event) => setOcrPageCount(event.target.value)}
              />
              <span className="hint">OCR only the first N pages; remaining pages are still attached.</span>
            </label>
          </>
        )}

        <button className="primary full" type="submit" disabled={submitting}>
          {submitting ? 'Uploading...' : 'Upload record'}
        </button>
      </form>
      {uploadSummary ? (
        <div className="upload-summary">
          <p><strong>visit_date:</strong> {formatDate(uploadSummary.visitDate)}</p>
          <p>
            <strong>invoice_number:</strong>{' '}
            {uploadSummary.invoiceNumber && uploadSummary.visitIds[0] ? (
              <a href={`/?tab=search&visitId=${uploadSummary.visitIds[0]}`}>
                {uploadSummary.invoiceNumber}
              </a>
            ) : (
              uploadSummary.invoiceNumber || 'n/a'
            )}
          </p>
          <p><strong>pet_names:</strong> {uploadSummary.petNames.join(', ') || 'n/a'}</p>
        </div>
      ) : null}
      {status ? (
        <p className={/failed|missing|choose|not configured|duplicate/i.test(status) ? 'error' : ''}>
          {status}
        </p>
      ) : null}
    </section>
  );
}
