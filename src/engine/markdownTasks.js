/* ============================================================
   MARKDOWN TASK LISTS — ticking a box in the rendered doc

   marked turns "- [ ] thing" into a checkbox, but the document of record is
   the markdown, not the DOM. So a tick has to go back the other way: find the
   nth task line in the source and flip its marker.

   Keyed by position rather than by the text beside it, because two items are
   allowed to read the same and renaming one must not move another's state.
   The nth checkbox on screen is the nth task line in the source -- which holds
   as long as this counts lines the renderer would also have counted, hence the
   fence handling below.
   ============================================================ */

// Bullet or numbered, any indent, followed by an empty or ticked marker. The
// leading group is captured so rewriting preserves the indent and the bullet
// style exactly as the author typed them.
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

// ``` or ~~~, any indent, opening or closing. Lines inside a fence are code,
// and marked renders them verbatim -- a "- [ ]" in a shell snippet is not a
// checkbox, and counting it would shift every real one after it by one.
const FENCE = /^\s*(```|~~~)/;

function eachTaskLine(markdown, visit) {
  const lines = String(markdown == null ? '' : markdown).split('\n');
  let inFence = false;
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!TASK.test(lines[i])) continue;
    index += 1;
    if (visit(i, index, lines) === true) return lines;
  }
  return lines;
}

export function countTasks(markdown) {
  let n = 0;
  eachTaskLine(markdown, () => { n += 1; });
  return n;
}

// Returns the new markdown, or null when there is no task at that index --
// which means the DOM and the source have drifted, and the right move is to
// leave both alone rather than write a guess back to the server.
export function setTaskAt(markdown, index, checked) {
  let hit = false;
  const lines = eachTaskLine(markdown, (line, at, all) => {
    if (at !== index) return false;
    hit = true;
    all[line] = all[line].replace(TASK, (_m, lead) => `${lead}[${checked ? 'x' : ' '}]`);
    return true;
  });
  return hit ? lines.join('\n') : null;
}
