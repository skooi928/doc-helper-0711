# VSCode Extension – Documentation Agent Requirements

## Feature 1: Documentation Issue Detection & Suggestions

- If documentation exists, the extension should analyze it.
- Detect missing sections, unclear writing, or structural issues.
- Provide AI-based suggestions on:
  - Parts not written.
  - Improvements to existing content.
  - Fixes for formatting or clarity.

---

## Feature 2: AI Update & Merge Review

- When the AI generates an updated version of documentation:
  - The extension should **prompt the user** to accept or reject changes.
  - A **merge conflict editor view** should be shown:
    - **Left:** Original documentation.
    - **Right:** AI-generated documentation.
    - Highlight differences in the text (similar to Git diff).

---

## Feature 3: Documentation Snippet Template

- When a new documentation file is created and the user types `"doc"`:
  - The extension should **auto-expand into a documentation template snippet**.
  - Works similar to how `"html"` expands to boilerplate HTML in VSCode.
- This template provides a structured starting point for writing documentation.
