# Retired capture workflow

Screenshot capture on `.45` belongs to QuestForge. The workflow that used to live at `.github/workflows/screenshots-45.yml` has been removed from this repository so it cannot queue jobs.

Merged history, not the current product:

- https://github.com/kevinwolrath/quest-forge-screenshots/pull/1
- https://github.com/kevinwolrath/quest-forge-screenshots/pull/2

That workflow is not scheduled. Do not put it back under `.github/workflows`. Do not add a manual dispatch trigger, a push or pull-request trigger, or a self-hosted runner label in this repository.

The capture tool, Dockerfile, and Compose file remain in the tree so the earlier work stays readable. Fixture checks of that tool are not QuestForge captures and are not `.45` runs. A live `.45` capture was not verified from this repository.
