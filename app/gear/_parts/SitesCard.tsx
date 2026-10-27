import { type Water, WATERS } from "@/lib/kit";
import { type Data, Failure, useSave, WATER_LABEL } from "@/components/gear/shared";

export function SitesCard({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const { save, failure } = useSave();
  const names = [...new Set([...data.siteNames, ...data.sites.map((s) => s.name)])].sort((a, b) => a.localeCompare(b));
  const waterAt = (name: string) => data.sites.find((s) => s.name.toLowerCase() === name.toLowerCase())?.water;
  async function choose(name: string, water: Water) {
    if (await save({ sites: [{ name, water: waterAt(name) === water ? null : water }] })) onSaved();
  }
  return (
    <section className="card stack" aria-labelledby="sites-h">
      <h2 id="sites-h" style={{ margin: 0 }}>
        Water at your dive sites
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Salt water carries about 2.5 % more than fresh. Every dive at a site takes its water; click the chosen one again to clear it.
      </p>
      {!names.length ? (
        <p className="muted">No dive sites yet: fill in the site of your dives first.</p>
      ) : (
        <ul className="gear-list">
          {names.map((name) => (
            <li key={name}>
              <strong>{name}</strong>
              <div className="segmented small" role="radiogroup" aria-label={`Water at ${name}`}>
                {WATERS.map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={waterAt(name) === w} onClick={() => choose(name, w)}>
                    {WATER_LABEL[w]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Failure text={failure} />
    </section>
  );
}
