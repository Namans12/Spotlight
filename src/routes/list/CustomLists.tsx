import { useWatchlistContext } from '@/contexts/watchlist-context';
import { CustomListsPanel } from '@/components/watchlist/CustomListsPanel';

export default function CustomLists() {
  const wl = useWatchlistContext();

  return (
    <CustomListsPanel
      lists={wl.customLists}
      listItems={wl.customListItems}
      onCreate={wl.createList}
      onDelete={wl.deleteList}
      onRemoveItem={wl.removeFromCustomList}
    />
  );
}
