import { FormEvent, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Household, Pet } from '../types/api';

type UploadMode = 'single' | 'images';

interface UploadRecordPanelProps {
  households: Household[];
  pets: Pet[];
  onUploaded: () => void;
}

export function UploadRecordPanel({ households, pets, onUploaded }: UploadRecordPanelProps) {
  const [mode, setMode] = useState<UploadMode>('single');
  const [householdId, setHouseholdId] = useState('');
  const [petId, setPetId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredPets = useMemo(
    () => pets.filter((pet) => !householdId || pet.householdId === householdId),
    [pets, householdId],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus('');

    if (!householdId) {
      setStatus('Choose a household first.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        householdId,
        petId: petId || undefined,
        visitDate: visitDate || undefined,
      };

      if (mode === 'single') {
        if (!singleFile) {
          setStatus('Choose a PDF or image file.');
          return;
        }
        const result = await api.uploadDocument(singleFile, payload);
        const message = result?.ocr?.message || 'Upload complete.';
        setStatus(message);
        onUploaded();
        setSingleFile(null);
        setImageFiles([]);
        return;
      } else {
        if (!imageFiles.length) {
          setStatus('Choose one or more JPG/PNG files.');
          return;
        }
        const result = await api.uploadDocumentImages(imageFiles, payload);
        const message = result?.ocr?.message || 'Upload complete.';
        setStatus(message);
        onUploaded();
        setSingleFile(null);
        setImageFiles([]);
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
      <form className="grid" onSubmit={submit}>
        <label className="field">
          Upload mode
          <select value={mode} onChange={(event) => setMode(event.target.value as UploadMode)}>
            <option value="single">Single PDF/image</option>
            <option value="images">Multiple images as one record</option>
          </select>
        </label>

        <label className="field">
          Household
          <select
            value={householdId}
            onChange={(event) => {
              setHouseholdId(event.target.value);
              setPetId('');
            }}
          >
            <option value="">Select household</option>
            {households.map((household) => (
              <option key={household.id} value={household.id}>
                {household.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Pet (optional)
          <select value={petId} onChange={(event) => setPetId(event.target.value)}>
            <option value="">All/Unknown</option>
            {filteredPets.map((pet) => (
              <option key={pet.id} value={pet.id}>
                {pet.name} ({pet.species})
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Visit date (optional)
          <input
            type="date"
            value={visitDate}
            onChange={(event) => setVisitDate(event.target.value)}
          />
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
          <label className="field full">
            Record pages (JPG/PNG)
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={(event) => setImageFiles(Array.from(event.target.files || []))}
            />
          </label>
        )}

        <button className="primary" type="submit" disabled={submitting}>
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
