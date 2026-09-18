import { API_ORIGIN } from "../api/client";

export function DocsPage() {
  function openApiDocs() {
    window.open(`${API_ORIGIN}/`, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="page-panel" aria-labelledby="docs-title">
      <p className="eyebrow">Developer resources</p>
      <h1 id="docs-title">API documentation</h1>
      <p>
        Open the interactive API reference to explore endpoints and response
        formats.
      </p>
      <button type="button" onClick={openApiDocs}>
        Open API docs
      </button>
    </section>
  );
}
