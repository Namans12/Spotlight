import { MessageCircle } from 'lucide-react';
import type { BusinessType } from '../../../shared/types/pulse';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { pulseConfigured } from '@/lib/pulseApi';
import { cn } from '@/lib/utils';
import { PulseChat } from './PulseChat';

/** Tailwind's `md`, in rem like the rest of the app (see use-mobile.tsx). */
const DESKTOP = '(min-width: 48rem)';

/**
 * "Ask Pulse": opens the chat in a sheet. A right-hand panel from 768 px up and
 * a bottom sheet (85% of the viewport, rounded top corners) below that.
 * Renders nothing on a deployment with no Pulse service. The chat inside only
 * exists while the sheet is open, so closing it ends any running answer and
 * drops the conversation.
 */
export function PulseChatLauncher({ city, type, title }: { city: string; type: BusinessType; title?: string }) {
  // jsdom and server rendering have no matchMedia; both fall back to the panel.
  const desktop = useMediaQuery(DESKTOP, true);
  if (!pulseConfigured()) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-control min-h-11 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-semibold text-foreground hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircle size={13} aria-hidden />
          Ask Pulse
        </button>
      </SheetTrigger>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        // Radix would focus the first control; the question box is the one that matters.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center [&>button]:right-1 [&>button]:top-1',
          desktop ? 'w-full sm:max-w-md' : 'h-[85dvh] rounded-t-2xl',
        )}
      >
        <SheetHeader className="space-y-1 px-4 pb-1 pt-4 pr-12 text-left">
          <SheetTitle>Ask Pulse</SheetTitle>
          <SheetDescription>Ask about this week&rsquo;s releases and what they mean for a business in your city.</SheetDescription>
        </SheetHeader>
        <PulseChat city={city} type={type} title={title} autoFocus />
      </SheetContent>
    </Sheet>
  );
}
