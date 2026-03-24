'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { ChevronDown } from 'lucide-react';

interface Physician {
  PHYSICIAN_ID: string;
  PHYSICIAN_FIRST_NAME: string;
  PHYSICIAN_LAST_NAME: string;
  PHYSICIAN_SPECIALTY: string;
  PHYSICIAN_ADDRESS_LINE_1: string;
  PHYSICIAN_CITY: string;
  PHYSICIAN_STATE: string;
  PHYSICIAN_ZIP_CODE: number;
  PHYSICIAN_YEARS_IN_PRACTICE: number;
  SALES_GEOGRAPHY: string;
}

interface PhysicianSelectorProps {
  selectedPhysician: string | null;
  onSelect: (physicianId: string) => void;
}

export default function PhysicianSelector({
  selectedPhysician,
  onSelect,
}: PhysicianSelectorProps) {
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetchPhysicians();
  }, []);

  const fetchPhysicians = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/physicians');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      setPhysicians(data.physicians || []);
    } catch (err) {
      console.error('[PhysicianSelector] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load physicians.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPhysicianData = physicians.find(
    (p) => p.PHYSICIAN_ID === selectedPhysician
  );

  return (
    <div className="relative w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-lg text-left flex items-center justify-between hover:border-slate-300 transition-colors"
      >
        <div className="flex-1">
          {loading ? (
            <span className="text-slate-500">Loading physicians...</span>
          ) : error ? (
            <span className="text-red-500 text-sm">{error}</span>
          ) : selectedPhysicianData ? (
            <div>
              <p className="font-medium text-slate-900">
                Dr. {selectedPhysicianData.PHYSICIAN_FIRST_NAME} {selectedPhysicianData.PHYSICIAN_LAST_NAME}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {selectedPhysicianData.PHYSICIAN_SPECIALTY} • {selectedPhysicianData.PHYSICIAN_CITY}, {selectedPhysicianData.PHYSICIAN_STATE}
              </p>
            </div>
          ) : (
            <span className="text-slate-500">Select a physician</span>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-600 transition-transform ${isOpen ? 'rotate-180' : ''
            }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-slate-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {physicians.length === 0 ? (
            <div className="p-4 text-slate-600 text-center">No physicians found</div>
          ) : (
            physicians.map((physician) => (
              <button
                key={physician.PHYSICIAN_ID}
                onClick={() => {
                  onSelect(physician.PHYSICIAN_ID);
                  setIsOpen(false);
                }}
                className={`w-full text-left p-4 border-b border-slate-100 hover:bg-blue-50 transition-colors last:border-b-0 ${selectedPhysician === physician.PHYSICIAN_ID ? 'bg-blue-100' : ''
                  }`}
              >
                <p className="font-medium text-slate-900">
                  Dr. {physician.PHYSICIAN_FIRST_NAME} {physician.PHYSICIAN_LAST_NAME}
                </p>
                <p className="text-sm text-slate-600 mt-1">{physician.PHYSICIAN_SPECIALTY}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {physician.PHYSICIAN_CITY}, {physician.PHYSICIAN_STATE} {physician.PHYSICIAN_ZIP_CODE}
                </p>
                <p className="text-xs text-blue-600 mt-1">{physician.SALES_GEOGRAPHY}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
