import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DocumentRecord, SearchVisit } from '../types/api';

interface DocumentInspectorProps {
  visit?: SearchVisit;
  onDeleted: (documentId: string) => void;
}

export function DocumentInspector({ visit, onDeleted }: DocumentInspectorProps) {
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [documentDetails, setDocumentDetails] = useState<DocumentRecord | undefined>();
  const [loadingDetails, setLoadingDetails] = useState(false);
  const activeDocumentId = visit?.document.id;
  const formatCurrency = (value?: string | number | null) => {
    if (value === null || value === undefined || value === '') return 'n/a';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return parsed.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  };
  const toNumber = (value?: string | number | null) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const isPaymentLineItem = (description: string, totalPrice?: string | number | null) => {
    const normalized = description.toLowerCase();
    const price = toNumber(totalPrice);
    if (/\bpayment\b/.test(normalized)) {
      return true;
    }
    if (/^\s*(visa|mastercard|amex|discover|cash|check)\b/.test(normalized)) {
      return true;
    }
    if (price < 0) {
      return true;
    }
    return false;
  };
  const formatReceiptDate = (value?: string | null) => {
    if (!value) return 'n/a';
    const raw = value.slice(0, 10);
    const parts = raw.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      if (year && month && day) {
        return `${month}/${day}/${year}`;
      }
    }
    return raw;
  };

  useEffect(() => {
    if (!activeDocumentId) {
      setDocumentDetails(undefined);
      setLoadingDetails(false);
      return;
    }
    setDocumentDetails(undefined);
    setLoadingDetails(true);
    void (async () => {
      try {
        const details = await api.document(activeDocumentId);
        setDocumentDetails(details);
      } catch {
        setDocumentDetails(undefined);
      } finally {
        setLoadingDetails(false);
      }
    })();
  }, [activeDocumentId]);

  if (!visit) {
    return <p className="empty">Select a search result to inspect OCR and source PDF.</p>;
  }

  const activeVisit = visit;
  const fileUrl = `${api.baseUrl}/documents/${activeVisit.document.id}/file`;

  const parsedVisits =
    documentDetails?.visits?.length
      ? documentDetails.visits
      : [
          {
            id: activeVisit.id,
            visitDate: activeVisit.visitDate,
            invoiceNumber: activeVisit.invoiceNumber,
            totalCharges: activeVisit.totalCharges,
            totalPayments: activeVisit.totalPayments,
            pet: activeVisit.pet,
            lineItems: activeVisit.lineItems,
            reminders: activeVisit.reminders,
          },
        ];

  const parsedVisitsWithFilteredItems = parsedVisits.map((parsedVisit) => ({
    ...parsedVisit,
    lineItems: parsedVisit.lineItems.filter(
      (item) => !isPaymentLineItem(item.description || '', item.totalPrice),
    ),
  }));
  const perPetTotals = parsedVisitsWithFilteredItems.map((parsedVisit) =>
    parsedVisit.lineItems.reduce((sum, item) => sum + toNumber(item.totalPrice), 0),
  );
  const combinedOcrText = (documentDetails?.pages || activeVisit.document.pages)
    .map((page) => page.fullText)
    .join('\n\n');
  const extractedFields = documentDetails?.extractedFields || activeVisit.document.extractedFields || [];
  const getExtractedNumber = (fieldName: string) => {
    const match = extractedFields.find((field) => field.fieldName === fieldName);
    if (!match) return undefined;
    const parsed = Number(match.fieldValue);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const receiptTotalFromExtracted = getExtractedNumber('receipt_total_price');
  const receiptTotalPrice = receiptTotalFromExtracted ?? perPetTotals.reduce((sum, value) => sum + value, 0);
  const paymentFromExtracted = getExtractedNumber('payment_amount');
  const paymentValueFromData = parsedVisitsWithFilteredItems.find(
    (parsedVisit) => Math.abs(toNumber(parsedVisit.totalPayments)) > 0,
  );
  const paymentAmount =
    paymentFromExtracted ??
    (paymentValueFromData ? Math.abs(toNumber(paymentValueFromData.totalPayments)) : undefined) ??
    receiptTotalPrice;
  const visitDate = parsedVisits[0]?.visitDate || activeVisit.visitDate;
  const invoiceNumber = parsedVisits[0]?.invoiceNumber || activeVisit.invoiceNumber || 'n/a';
  const paymentLabel = "Payment";

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
      onDeleted(activeVisit.document.id);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="panel two-col">
      <div className="inspector-pane">
        <div className="inspector-head">
          <h2>Scanned document</h2>
          <button className="danger" type="button" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete record'}
          </button>
        </div>
        <iframe src={fileUrl} title="Scanned pet record" className="pdf-frame" />
      </div>
      <div className="inspector-pane inspector-details">
        <h2>OCR + parsed fields</h2>
        {loadingDetails ? <p>Loading parsed fields...</p> : null}
        <div className="parsed-grid">
          <p>
            <strong>visit_date:</strong> {formatReceiptDate(visitDate)}
          </p>
          <p>
            <strong>invoice_number:</strong> {invoiceNumber}
          </p>
          <p>
            <strong>{paymentLabel}:</strong> {formatCurrency(Math.abs(paymentAmount))}
          </p>
          <p>
            <strong>receipt_total_price:</strong> {formatCurrency(receiptTotalPrice)}
          </p>
        </div>
        {parsedVisitsWithFilteredItems.map((parsedVisit) => (
          <div key={parsedVisit.id} className="parsed-grid pet-section">
            <p>
              <strong>pet_name:</strong> {parsedVisit.pet.name || 'n/a'}
            </p>
            <p>
              <strong>visit_date:</strong> {formatReceiptDate(parsedVisit.visitDate)}
            </p>
            <p>
              <strong>total_price:</strong>{' '}
              {formatCurrency(
                parsedVisit.lineItems.reduce((sum, item) => sum + toNumber(item.totalPrice), 0),
              )}
            </p>
            <h4>Line Items</h4>
            <table className="parsed-table">
              <thead>
                <tr>
                  <th>service_description</th>
                  <th>itemized_price</th>
                </tr>
              </thead>
              <tbody>
                {parsedVisit.lineItems.length ? (
                  parsedVisit.lineItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{formatCurrency(item.totalPrice)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2}>n/a</td>
                  </tr>
                )}
              </tbody>
            </table>
            <h4>Reminders</h4>
            <table className="parsed-table">
              <thead>
                <tr>
                  <th>future_service_date</th>
                  <th>description</th>
                  <th>last_done</th>
                </tr>
              </thead>
              <tbody>
                {parsedVisit.reminders.length ? (
                  parsedVisit.reminders.map((reminder) => (
                    <tr key={reminder.id}>
                      <td>{formatReceiptDate(reminder.dueDate)}</td>
                      <td>{reminder.serviceName}</td>
                      <td>{formatReceiptDate(reminder.lastDoneDate)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>n/a</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
        <pre className="ocr-text">
          {combinedOcrText || 'No OCR text available'}
        </pre>
        {message ? <p className="error">{message}</p> : null}
      </div>
    </section>
  );
}
