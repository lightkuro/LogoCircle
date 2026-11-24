import { useUi } from '@/store/ui';
import { CHANGELOG } from '@/changelog';
import { Sheet } from '../primitives';

/** What's new: each version and what it brought, newest first. */
export function ChangesSheet() {
  const open = useUi((s) => s.sheet === 'changes');
  return (
    <Sheet open={open} onClose={() => useUi.setState({ sheet: null })} title="What's new" place="top-left">
      <div className="changes">
        {CHANGELOG.map((r) => (
          <section key={r.version} className="changes-release" aria-label={`Version ${r.version}`}>
            <h3>
              v{r.version} <span>{r.date}</span>
            </h3>
            <ul>
              {r.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
