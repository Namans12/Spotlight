import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BusinessType } from '../../../shared/types/pulse';
import { Segmented } from '@/components/ui/segmented';
import { BUSINESS_TYPE_OPTIONS, PULSE_CITIES } from '@/lib/pulseCities';

interface CityTypePickerProps {
  /** Pre-fills the form: the current profile when changing it, or whatever half of one the URL carried. */
  city: string | null;
  type: BusinessType | null;
  onSubmit: (city: string, type: BusinessType) => void;
  /** Present only when there is a profile to go back to. */
  onCancel?: () => void;
  /** Why the picker is showing, when it is not simply the first visit. */
  notice?: string;
}

/**
 * City + business type. A submit button rather than committing on every
 * change: picking a business type first and a city second would otherwise
 * flash a board for a profile the visitor never finished choosing.
 */
export function CityTypePicker({ city, type, onSubmit, onCancel, notice }: CityTypePickerProps) {
  const [draftCity, setDraftCity] = useState(city ?? '');
  const [draftType, setDraftType] = useState<BusinessType>(type ?? 'cafe');
  const selectId = useId();

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (draftCity) onSubmit(draftCity, draftType);
      }}
    >
      {notice && (
        <p role="alert" className="text-sm text-foreground">
          {notice}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={selectId} className="block text-xs font-semibold text-muted-foreground">
            City
          </label>
          {/* A native select: labelled, keyboard- and screen-reader-complete, and
              the OS picker is the right control on a phone for a list this short. */}
          <div className="relative">
            <select
              id={selectId}
              value={draftCity}
              onChange={(e) => setDraftCity(e.target.value)}
              className="h-control w-full appearance-none rounded-lg border border-border bg-secondary pl-3 pr-9 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>
                Choose a city
              </option>
              {PULSE_CITIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-muted-foreground">Business type</span>
          <Segmented<BusinessType>
            fill
            aria-label="Business type"
            options={BUSINESS_TYPE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
            value={draftType}
            onChange={setDraftType}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!draftCity}
          className="inline-flex h-control items-center justify-center rounded-lg bg-accent px-4 text-xs font-semibold text-accent-foreground transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
        >
          Show the board
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-control items-center rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
