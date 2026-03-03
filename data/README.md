# data/

This directory contains large data files that are gitignored.

## style-samples.json

Training data for agent style generation. Used by the setup wizard to seed
personality-consistent message examples.

Generate it with:

```bash
npx openclaw wizard style-samples --output data/style-samples.json
```

This file is ~5 MB and is not committed to the repo.
