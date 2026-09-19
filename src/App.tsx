import { Suspense, lazy } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { WatchlistProvider } from '@/contexts/WatchlistContext';
import { WebMcpBridge } from '@/webmcp/WebMcpBridge';
import { AutoGuestSession } from '@/webmcp/AutoGuestSession';
import { AgentChat } from '@/webmcp/AgentChat';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { IntroGate } from '@/components/intro/IntroGate';
import { RouteErrorBoundary } from '@/components/system/RouteErrorBoundary';
import { RouteFallback } from '@/components/system/RouteFallback';

const Home = lazy(() => import('./routes/Home'));
const Calendar = lazy(() => import('./routes/Calendar'));
const Search = lazy(() => import('./routes/Search'));
const Browse = lazy(() => import('./routes/Browse'));
const TitleDetail = lazy(() => import('./routes/TitleDetail'));
const TitleConnections = lazy(() => import('./routes/TitleConnections'));
const PersonDetail = lazy(() => import('./routes/PersonDetail'));
const Login = lazy(() => import('./routes/Login'));
const Wrapped = lazy(() => import('./routes/Wrapped'));
const Duel = lazy(() => import('./routes/Duel'));
const ListLayout = lazy(() => import('./routes/list/ListLayout'));
const Watchlist = lazy(() => import('./routes/list/Watchlist'));
const WatchLater = lazy(() => import('./routes/list/WatchLater'));
const Watched = lazy(() => import('./routes/list/Watched'));
const CustomLists = lazy(() => import('./routes/list/CustomLists'));

function NotFound() {
  return <p className="text-center text-sm text-muted-foreground py-20">Page not found.</p>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <WebMcpBridge />
    <AgentChat />
    <WatchlistProvider>
      <TooltipProvider>
        <IntroGate>
          <Toaster />
          <BrowserRouter>
            <AutoGuestSession />
            {/* Boundary sits above Suspense so it catches a *rejected* lazy
                import (a stale chunk after a deploy), which Suspense itself
                rethrows rather than handles. */}
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/calendar" element={<Calendar />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/browse" element={<Browse />} />
                    <Route path="/duel" element={<Duel />} />
                    <Route path="/title/:type/:id" element={<TitleDetail />} />
                    <Route path="/title/:type/:id/connections" element={<TitleConnections />} />
                    <Route path="/person/:id" element={<PersonDetail />} />
                    <Route path="/login" element={<Login />} />
                    <Route
                      path="/wrapped"
                      element={
                        <RequireAuth>
                          <Wrapped />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/list"
                      element={
                        <RequireAuth>
                          <ListLayout />
                        </RequireAuth>
                      }
                    >
                      <Route index element={<Navigate to="watchlist" replace />} />
                      <Route path="watchlist" element={<Watchlist />} />
                      <Route path="later" element={<WatchLater />} />
                      <Route path="watched" element={<Watched />} />
                      <Route path="lists" element={<CustomLists />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </BrowserRouter>
        </IntroGate>
      </TooltipProvider>
    </WatchlistProvider>
  </QueryClientProvider>
);

export default App;
