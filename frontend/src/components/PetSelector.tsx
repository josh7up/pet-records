import type { Pet } from '../types/api';

interface PetSelectorProps {
  pets: Pet[];
  selectedPetId: string;
  onChange: (petId: string) => void;
}

export function PetSelector({ pets, selectedPetId, onChange }: PetSelectorProps) {
  return (
    <label className="field">
      Pet
      <select value={selectedPetId} onChange={(event) => onChange(event.target.value)}>
        <option value="">All pets</option>
        {pets.map((pet) => (
          <option key={pet.id} value={pet.id}>
            {pet.name} ({pet.species})
          </option>
        ))}
      </select>
    </label>
  );
}
