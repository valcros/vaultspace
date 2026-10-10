# Bundled VaultSpace fonts

These WOFF2 files are the same Google Fonts families previously fetched by
`next/font/google` during each build. They are served from VaultSpace so builds
do not depend on a live Google Fonts response. The CSS in `src/app/fonts.css`
preserves the source subset ranges and `font-display: swap`; only the Latin
faces are preloaded.

Inter uses the variable 100 to 900 weight range. Bricolage Grotesque uses the
same variable subset files for weights 500, 600, and 700. Each family retains
its own Open Font License in this directory. The WOFF2 payloads are unmodified.

## Sources

- [Inter stylesheet](https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap), retrieved 2026-10-10 with the Next.js font-loader user agent
- [Bricolage Grotesque stylesheet](https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&display=swap), retrieved 2026-10-10 with the Next.js font-loader user agent
- [Inter license](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/inter/OFL.txt)
- [Bricolage Grotesque license](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/bricolagegrotesque/OFL.txt)
