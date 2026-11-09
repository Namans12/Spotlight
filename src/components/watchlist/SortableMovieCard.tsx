import type { ProviderOffer } from '../../../shared/types/availability';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { ReleaseCard } from '@/components/release/ReleaseCard';
import { fromMovie } from '@/types/digest';
import { WatchlistItem } from '@/types/movie';

interface SortableMovieCardProps {
  item: WatchlistItem;
  index: number;
  onMarkWatched: () => void;
  onRemove: () => void;
  onAddToWatchLater?: () => void;
  onAddToList?: () => void;
  /** TV only, from the seasons cache; null while loading or unknown. */
  seasons?: number | null;
  providers?: string[];
  offers?: ProviderOffer[] | null;
}

export function SortableMovieCard({ item, index, onMarkWatched, onRemove, onAddToWatchLater, onAddToList, seasons, providers, offers }: SortableMovieCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.dbId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ReleaseCard
        item={fromMovie(item)}
        index={index}
        seasons={seasons}
        providers={providers}
        offers={offers}
        onMarkWatched={onMarkWatched}
        onRemove={onRemove}
        onAddToWatchLater={onAddToWatchLater}
        onAddToList={onAddToList}
        compact
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            className="flex items-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          >
            <GripVertical size={16} />
          </button>
        }
      />
    </div>
  );
}
