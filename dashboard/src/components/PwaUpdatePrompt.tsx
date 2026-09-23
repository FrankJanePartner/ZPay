import { useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

export function PwaUpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const update = useRef<ReturnType<typeof registerSW> | null>(null);

  useEffect(() => {
    let active = true;
    update.current = registerSW({
      onNeedRefresh: () => { if (active) setReady(true); },
    });
    return () => { active = false; };
  }, []);

  async function reload() {
    if (pending || !update.current) return;
    setPending(true);
    setFailed(false);
    try {
      await update.current(true);
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  if (!ready) return null;
  return <aside className="pwa-update" aria-label="Application update">
    <p role="status">A new version is ready. Finish your current work before reloading.</p>
    {failed ? <p role="alert">The update could not be applied. Please try again.</p> : null}
    <div className="error-actions">
      <button type="button" disabled={pending} onClick={() => void reload()}>Reload to update</button>
      <button type="button" className="button-secondary" disabled={pending} onClick={() => setReady(false)}>Later</button>
    </div>
  </aside>;
}
