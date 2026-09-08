import { GLOSSARY } from '../engine/glossary';

export function GlossaryPanel() {
  return (
    <details id="glossaryBox">
      <summary>Glossary — what every term means</summary>
      <div className="details-body">
        <p className="gloss-intro">
          Plain-language definitions for every stat and term this app shows you. Nothing here assumes you have played before.
        </p>
        {GLOSSARY.map(({ group, terms }) => (
          <div className="gloss-group" key={group}>
            <div className="box-label">{group}</div>
            <dl className="gloss-list">
              {terms.map(([term, meaning]) => (
                <div className="gloss-item" key={term}>
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
