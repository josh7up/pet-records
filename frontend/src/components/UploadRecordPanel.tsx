import { FormEvent, useState } from 'react';
import { api } from '../api/client';

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
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('');

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
      {status ? (
        <p className={/failed|missing|choose|not configured|duplicate/i.test(status) ? 'error' : ''}>
          {status}
        </p>
      ) : null}
    </section>
  );
}
