import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { WatchlistItem } from '@/types/movie';
import { SortableMovieCard } from './SortableMovieCard';
import { useSeasons } from '@/hooks/useSeasons';
import { useProviders, useRuntimes } from '@/hooks/useProviders';
import { WatchNowBar } from './WatchNowBar';
import {
  EMPTY_FILTERS,
  availablePlatforms,
  availableRuntimeBands,
  filterWatchNow,
  hasActiveFilters,
  type WatchNowFilters,
} from '@/lib/watchNow';
import { ListX, SearchX } from 'lucide-react';
import { useState } from 'react';

interface WatchlistViewProps {
  items: WatchlistItem[];
  onReorder: (oldIndex: number, newIndex: number) => void;
  onMarkWatched: (dbId: number) => void;
  onRemove: (dbId: number) => void;
  onAddToWatchLater?: (dbId: number) => void;
  onAddToList?: (dbId: number) => void;
  emptyMessage?: string;
  /** Off for the Watched list, where "what can I watch right now" is not a
   * question anyone is asking. */
  showWatchNow?: boolean;
}

export function WatchlistView({ items, onReorder, onMarkWatched, onRemove, onAddToWatchLater, onAddToList, emptyMessage = 'Nothing here yet', showWatchNow = false }: WatchlistViewProps) {
  const seasonsFor = useSeasons(items);
  const providersFor = useProviders(items);
  // Same batch request as useProviders — TanStack dedupes on the shared query
  // key, so runtime costs nothing extra here or at TMDB.
  const runtimeFor = useRuntimes(items);
  const [filters, setFilters] = useState<WatchNowFilters>(EMPTY_FILTERS);

  const filtering = showWatchNow && hasActiveFilters(filters);
  const visible = showWatchNow ? filterWatchNow(items, filters, { providersFor, runtimeFor }) : items;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Indices into the FULL list, which is what onReorder persists against —
    // never into the filtered view. See the comment on the filtered branch
    // below for why dragging is switched off while a filter is on.
    const oldIndex = items.findIndex(i => i.dbId === active.id);
    const newIndex = items.findIndex(i => i.dbId === over.id);
    if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ListX size={48} className="mb-3 opacity-40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const cardsFor = (list: typeof items) =>
    list.map((item, idx) => (
      <SortableMovieCard
        key={item.dbId}
        item={item}
        index={idx}
        seasons={seasonsFor(item.mediaType, item.id)}
        providers={providersFor(item.mediaType, item.id)}
        onMarkWatched={() => onMarkWatched(item.dbId)}
        onRemove={() => onRemove(item.dbId)}
        onAddToWatchLater={onAddToWatchLater ? () => onAddToWatchLater(item.dbId) : undefined}
        onAddToList={onAddToList ? () => onAddToList(item.dbId) : undefined}
      />
    ));

  const bar = showWatchNow ? (
    <WatchNowBar
      filters={filters}
      onChange={setFilters}
      platforms={availablePlatforms(items, providersFor)}
      runtimeBands={availableRuntimeBands(items, runtimeFor)}
      shownCount={visible.length}
      totalCount={items.length}
    />
  ) : null;

  // Dragging is switched off while a filter is on, and this is a correctness
  // matter rather than a styling one: onReorder persists positions by index
  // into the FULL list, so a drag within a filtered subset would move whatever
  // happened to sit at those indices in the unfiltered order — silently
  // reordering titles the person cannot even see. "Reorder a filtered view"
  // has no well-defined meaning against a single stored order, so the honest
  // answer is to reorder the whole list or not at all.
  if (filtering) {
    return (
      <div>
        {bar}
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <SearchX size={36} className="mb-3 opacity-40" />
            <p className="text-sm">Nothing on your list fits that right now.</p>
          </div>
        ) : (
          <div className="space-y-2">{cardsFor(visible)}</div>
        )}
      </div>
    );
  }

  return (
    <div>
      {bar}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={items.map(i => i.dbId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">{cardsFor(items)}</div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
