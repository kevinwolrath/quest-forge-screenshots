Follow the repository guidance in [AGENTS.md](../AGENTS.md).

This repository is the private Cloudflare screenshot gallery and the publisher that uploads one validated ZIP. QuestForge owns screenshot capture and the `.45` runner. Do not add a capture workflow, a runner label, or a dispatch trigger here. Do not guess QuestForge filenames.

Keep viewer Cloudflare Access separate from the publisher secret. Fail closed. Keep R2 private. Replace the single current archive only after the ZIP validates. A failed publish keeps the previous archive.
