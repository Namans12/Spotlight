export function Footer() {
  return (
    <footer className="border-t border-border py-6 mt-8">
      <section aria-label="Credits" className="mx-auto max-w-2xl space-y-1 px-4 text-center text-xs text-muted-foreground">
        <p>Spotlight · Data from <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline"><img src="/tmdb-logo.svg" alt="" width="36" height="26" />TMDB</a></p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p>TMDB logo by Travis Bell, unmodified · <a href="https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg" target="_blank" rel="noopener noreferrer" className="underline">source</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY-SA 4.0</a></p>
      </section>
    </footer>
  );
}
