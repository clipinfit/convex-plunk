# Contributing

Use the commands in README.md. Add tests for changes to delivery state, retry decisions, or provider request shapes. Keep credentials out of fixtures and commits.

Run the package smoke test before proposing a release. Provider tests must use controlled recipients and explicit live credentials. Do not replace uncertain outcomes with automatic retries without proving the provider contract prevents duplicates.
