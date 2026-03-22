import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Pet, WeightPoint } from '../types/api';

interface WeightChartPanelProps {
  pet?: Pet;
  points: WeightPoint[];
}

export function WeightChartPanel({ pet, points }: WeightChartPanelProps) {
  if (!pet) {
    return <p className="empty">Choose a pet to view its weight trend.</p>;
  }

  const formatLocalDate = (value: string) => {
    const raw = value.slice(0, 10);
    const parts = raw.split('-');
    if (parts.length !== 3) return value;
    const [year, month, day] = parts.map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString();
  };

  const chartData = points.map((point) => ({
    id: point.id,
    date: formatLocalDate(point.measuredAt),
    weight: Number(point.weightValue),
    unit: point.weightUnit,
  }));

  return (
    <section className="panel">
      <h2>
        Weight trend: {pet.name} {pet.species !== 'OTHER' ? ` (${pet.species})` : ''}
      </h2>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="weight" stroke="#02577a" strokeWidth={3} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
