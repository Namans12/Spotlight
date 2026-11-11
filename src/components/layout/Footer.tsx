export function Footer() {
  return (
    <footer className="border-t border-border py-6 mt-8">
      <section aria-label="Credits" className="mx-auto max-w-2xl space-y-1 px-4 text-center text-xs text-muted-foreground">
        <p>Spotlight · Data from <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className="underline">TMDB</a></p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </section>
    </footer>
  );
}
