export function SessionPanels() {
  return (
    <div className="log-wrap">
      <details>
        <summary>Session stats &amp; read on you</summary>
        <div className="details-body">
          <div className="stat-grid" id="statGrid" />
          <div id="evTotals" />
          <div className="spark-wrap" id="evChartWrap" />
          <div className="spark-wrap" id="vpipChartWrap" />
          <button className="btn-reveal classify" id="btnClassify" type="button">Classify my style</button>
          <div className="classify-out" id="classifyOut" />
          <button className="reset-btn" id="btnReset" type="button">Reset all saved stats</button>
          <div className="mini-note">Stats are saved in this browser until you reset them.</div>
        </div>
      </details>

      <details>
        <summary>Hand log</summary>
        <div className="details-body"><div className="log" id="log"><div>No hands played yet.</div></div></div>
      </details>

      <details>
        <summary>Send feedback</summary>
        <div className="details-body">
          <form id="fbForm" name="feedback" method="POST" data-netlify="true" data-netlify-honeypot="bot-field">
            <input type="hidden" name="form-name" value="feedback" />
            <p className="fb-hp"><label>Leave blank <input name="bot-field" /></label></p>
            <div className="fb-field"><label htmlFor="feedbackName">Your name (optional)</label><input id="feedbackName" type="text" name="name" autoComplete="name" /></div>
            <div className="fb-field"><label htmlFor="feedbackRating">How did it feel to play?</label>
              <select id="feedbackRating" name="rating" defaultValue="">
                <option value="">Pick one…</option>
                <option>Great — felt like real poker</option>
                <option>Good, but something is off</option>
                <option>Confusing in places</option>
                <option>Found a bug</option>
              </select>
            </div>
            <div className="fb-field"><label htmlFor="feedbackMessage">What stood out, good or bad?</label><textarea id="feedbackMessage" name="message" required /></div>
            <input type="hidden" name="build" id="fbBuild" />
            <button type="submit" style={{ width: '100%' }}>Send</button>
            <div className="fb-msg" id="fbMsg" />
          </form>
          <div className="build-tag" id="buildTag" />
        </div>
      </details>
    </div>
  );
}
