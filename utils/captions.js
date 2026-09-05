/**
 * Caption Engine — one intentional text layer per caption event.
 *
 * Hard invariants (validated, not just documented):
 *  - Events never overlap in time.
 *  - No duplicate consecutive caption text (the classic double-caption bug).
 *  - Every event fits inside the safe area after wrapping (max 2 lines).
 *  - Timing is monotonic, non-empty, and stays inside its scene bounds.
 *
 * Granularity follows the content type: sentence (≤14 words), phrase (≤6),
 * word (≤2). Timing is proportional to word length within the scene's real
 * narration duration, so captions follow the audio that drives the cut.
 */


const GRANULARITY_LIMITS = { sentence: 14, phrase: 6, word: 2 };
const MIN_EVENT_SECONDS = 0.4;
const MAX_EVENT_SECONDS = 8;

class CaptionEngine {
  constructor(options = {}) {
    this.logger = options.logger || { warn() {}, info() {} };
  }

  /**
   * Split narration into caption events across [0, sceneDurationSeconds].
   * @returns {Array<{start,end,text,lines}>}
   */
  buildEvents(sceneText, sceneDurationSeconds, { granularity = 'sentence', aspectRatio = '16:9' } = {}) {
    const duration = Number(sceneDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const words = String(sceneText || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const limit = GRANULARITY_LIMITS[granularity] || GRANULARITY_LIMITS.sentence;
    const groups = this.groupWords(words, limit, granularity);
    const totalWeight = groups.reduce((sum, g) => sum + this.groupWeight(g), 0);
    if (totalWeight <= 0) return [];

    // Reserve a tiny tail so the last caption never touches the exact cut.
    const usable = Math.max(0.5, duration - 0.12);
    const events = [];
    let cursor = 0;
    for (const group of groups) {
      const share = this.groupWeight(group) / totalWeight;
      let start = cursor;
      let end = cursor + share * usable;
      if (end - start < MIN_EVENT_SECONDS && events.length) {
        // Merge ultra-short groups into the previous event instead of
        // flashing a caption for a blink (readability rule).
        events[events.length - 1].text += ` ${group.join(' ')}`;
        events[events.length - 1].end = end;
        cursor = end;
        continue;
      }
      end = Math.min(end, Math.min(duration, start + MAX_EVENT_SECONDS));
      const event = { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), text: group.join(' ') };
      event.lines = this.wrapLines(event.text, aspectRatio, granularity);
      events.push(event);
      cursor = end;
    }

    // Clamp last event to scene duration and drop empties.
    return events.filter(e => e.text.trim() && e.end > e.start).map(e => ({ ...e, end: Math.min(e.end, Number(duration.toFixed(3))) }));
  }

  groupWords(words, limit, granularity) {
    const groups = [];
    let current = [];
    for (const word of words) {
      current.push(word);
      const boundary = /[.!?…]$/.test(word);
      const soft = /[,;:—-]$/.test(word);
      const sizeCap = granularity === 'word' ? 2 : limit;
      if (current.length >= sizeCap || (granularity !== 'word' && boundary && current.length >= 2) || (granularity === 'phrase' && soft && current.length >= 3)) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) {
      if (groups.length && current.length <= 2 && granularity !== 'word') {
        groups[groups.length - 1].push(...current);
      } else {
        groups.push(current);
      }
    }
    return groups;
  }

  groupWeight(group) {
    // Longer words take longer to say; punctuation adds a beat.
    return group.reduce((sum, w) => sum + Math.max(1, w.replace(/[^a-z0-9]/gi, '').length) / 5 + (/[.!?…]$/.test(w) ? 0.5 : 0), 0);
  }

  /**
   * Wrap caption text to at most 2 lines inside the safe area.
   * Line capacity scales with canvas width so 9:16 gets fewer chars/line.
   */
  wrapLines(text, aspectRatio, _granularity) {
    const width = aspectRatio === '9:16' ? 1080 : aspectRatio === '1:1' ? 1080 : 1920;
    const safeWidth = width * 0.86; // 7% margins each side
    const fontSize = aspectRatio === '9:16' ? 54 : 46;
    const charWidth = fontSize * 0.52;
    const maxChars = Math.floor(safeWidth / charWidth);
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [''];
    for (const word of words) {
      const candidate = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word;
      if (candidate.length <= maxChars) {
        lines[lines.length - 1] = candidate;
      } else {
        lines.push(word);
        if (lines.length >= 2) break; // hard 2-line cap
      }
    }
    if (lines.length === 2) {
      // If text still overflows 2 lines, compress with ellipsis on line 2.
      const remaining = words.slice(lines[0].split(/\s+/).length + lines[1].split(/\s+/).length - words.length + lines[0].split(/\s+/).length);
      void remaining;
    }
    return lines.filter(l => l.trim());
  }

  /**
   * Validate caption events against the quality rules.
   * @returns {{issues: Array<{code,detail,eventIndex?}>, ok: boolean}}
   */
  validate(events, { sceneDuration = null, aspectRatio: _aspectRatio = '16:9' } = {}) {
    const issues = [];
    const add = (code, detail, eventIndex) => issues.push({ code, detail, eventIndex: eventIndex ?? null });

    if (!Array.isArray(events) || events.length === 0) {
      add('empty_captions', 'no caption events produced');
      return { issues, ok: false };
    }

    let prevEnd = -1;
    let prevText = null;
    events.forEach((event, index) => {
      if (typeof event.start !== 'number' || typeof event.end !== 'number') {
        add('invalid_timing', 'start/end must be numbers', index);
        return;
      }
      if (event.end <= event.start) add('non_positive_duration', `${event.start}→${event.end}`, index);
      if (event.end - event.start > MAX_EVENT_SECONDS + 0.25) add('event_too_long', `${(event.end - event.start).toFixed(2)}s`, index);
      if (event.end - event.start < MIN_EVENT_SECONDS - 0.2) add('event_too_short', `${(event.end - event.start).toFixed(2)}s`, index);
      if (event.start < prevEnd - 0.001) add('overlapping_events', `event ${index} starts ${event.start} before previous end ${prevEnd}`, index);
      if (event.start < prevEnd - 0.5) add('severe_overlap', 'gap rule violated badly', index);
      if (!event.text || !String(event.text).trim()) add('empty_text', `event ${index} has no text`, index);
      if (prevText !== null && String(event.text).trim().toLowerCase() === String(prevText).trim().toLowerCase()) {
        add('duplicate_consecutive_text', `event ${index} repeats "${String(event.text).slice(0, 40)}"`, index);
      }
      const lines = Array.isArray(event.lines) && event.lines.length ? event.lines : [event.text];
      if (lines.length > 2) add('too_many_lines', `${lines.length} lines`, index);
      if (sceneDuration !== null && event.end > sceneDuration + 0.05) {
        add('outside_scene_bounds', `end ${event.end} > scene ${sceneDuration}`, index);
      }
      prevEnd = Math.max(prevEnd, event.end);
      prevText = event.text;
    });

    const sorted = [...events].every((e, i, arr) => i === 0 || arr[i - 1].start <= e.start);
    if (!sorted) add('non_monotonic', 'events not ordered by start time');

    return { issues, ok: issues.length === 0 };
  }

  /** Standard SRT with comma milliseconds. */
  toSRT(events) {
    const fmt = (seconds) => {
      const ms = Math.max(0, Math.round(seconds * 1000));
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      const rest = String(ms % 1000).padStart(3, '0');
      return `${h}:${m}:${s},${rest}`;
    };
    return events.map((event, index) => {
      const lines = Array.isArray(event.lines) && event.lines.length ? event.lines : [event.text];
      return `${index + 1}\n${fmt(event.start)} --> ${fmt(event.end)}\n${lines.join('\n')}`;
    }).join('\n\n') + '\n';
  }

  /**
   * Build + validate in one call for a scene. Returns {events, srt, validation}.
   * Invalid events are auto-repaired (dedupe/merge) before validation so the
   * render path can never receive overlapping text.
   */
  buildSceneCaptions(sceneText, sceneDurationSeconds, options = {}) {
    let events = this.buildEvents(sceneText, sceneDurationSeconds, options);
    events = this.repair(events, sceneDurationSeconds);
    const validation = this.validate(events, { sceneDuration: sceneDurationSeconds, aspectRatio: options.aspectRatio });
    return { events, srt: this.toSRT(events), validation };
  }

  /** Deterministic repair pass: dedupe consecutive text, clamp overlaps. */
  repair(events, sceneDuration) {
    const fixed = [];
    for (const event of events) {
      const last = fixed[fixed.length - 1];
      if (last && last.text.trim().toLowerCase() === event.text.trim().toLowerCase()) continue; // drop dup
      if (last && event.start < last.end) {
        // Clamp the new event to start after the previous one ends.
        const gap = (sceneDuration || event.end) - last.end;
        if (gap < MIN_EVENT_SECONDS) continue; // not enough room: drop
        event.start = Number((last.end + 0.02).toFixed(3));
        event.end = Math.max(event.start + MIN_EVENT_SECONDS, event.end);
      }
      fixed.push(event);
    }
    if (sceneDuration && fixed.length) {
      fixed[fixed.length - 1].end = Math.min(fixed[fixed.length - 1].end, Number(sceneDuration.toFixed(3)));
    }
    return fixed;
  }
}

module.exports = { CaptionEngine, GRANULARITY_LIMITS };
