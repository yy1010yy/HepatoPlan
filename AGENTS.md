## Human-Readable File Explanations

Whenever you create a new source code file or make substantial changes to an existing source code file, maintain a corresponding human-readable explanation inside `.codex-notes/`.

### Location

- Mirror the project's directory structure inside `.codex-notes/`.
- Each explanation must correspond to its source file.
- Use the same filename, with a `.txt` extension.
- Example: `backend/controllers/classController.ts` → `.codex-notes/backend/controllers/classController.txt`.
- The `.codex-notes/` directory is excluded from Git. Never add it to version control.

### Writing Style

Write explanations for a developer who wants to understand the code without having to read the implementation first.

Keep explanations concise, natural, and conversational. Avoid formal technical documentation, excessive Markdown, unnecessary headings, and line-by-line descriptions.

Each explanation should cover:

1. **Purpose:** What this file does and why it exists.
2. **Execution flow:** What happens when the relevant functionality is used.
3. **Responsibilities:** What logic this file handles and what it delegates to other files.
4. **Important decisions:** Explain non-obvious implementation choices, design decisions, and potential pitfalls.

### Guidelines

- Prefer explaining concepts and reasoning over describing syntax.
- Explain how the file fits into the larger application.
- Mention important dependencies and interactions with other files where relevant.
- Explain unfamiliar concepts when they are introduced.
- Do not document obvious code or every individual function.
- Do not generate lengthy documentation. Aim for approximately 100–250 words per file, adjusting for complexity.
- Update existing explanations when substantial implementation changes make them outdated.
- Do not create explanations for trivial configuration changes, generated files, lockfiles, assets, or files that contain no meaningful application logic.
- Do not duplicate the source code in the explanations.

### Maintenance

Treat these explanations as a persistent local knowledge base. Whenever you create or substantially modify relevant source files, update their explanations in the same task. Do not wait for me to explicitly request documentation.
