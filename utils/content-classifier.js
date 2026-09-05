/**
 * Content Classification Agent
 *
 * Decides WHAT KIND of video to produce and returns the full production
 * strategy for the selected content type.
 *
 * Two independent paths, merged defensively:
 *  1. AI classification (any configured text provider) — understands nuance.
 *  2. Heuristic alias scoring against the content-type registry — always
 *     available, deterministic, and the fallback when AI is unavailable,
 *     rate-limited, or returns garbage.
 *
 * The output shape is stable regardless of which path won, so downstream
 * stages never branch on the classifier internals.
 */

const { CONTENT_TYPES, resolveContentType, listContentTypeIds } = require('./content-types');
const { Logger } = require('./logger');

const KNOWN_TYPE_IDS = new Set(listContentTypeIds());

/** Legacy strategy.format values used by the existing 7-agent pipeline. */
const LEGACY_FORMAT_MAP = {
  explainer: 'explainer',
  tutorial: 'tutorial',
  list: 'listicle',
  review: 'product_review',
  story: 'storytelling'
};

/** Keywords that signal recency-sensitive topics (news/trending/awareness). */
const RECENCY_WORDS = ['latest', 'breaking', 'today', 'yesterday', 'this week', 'this month', 'new', 'just', 'announced', 'released', 'update', 'now', '2025', '2026'];

function heuristicClassify({ topic = '', instructions = '', audience = '' } = {}) {
  const haystack = ` ${topic} ${instructions} ${audience} `.toLowerCase();
  const scores = new Map();

  for (const type of Object.values(CONTENT_TYPES)) {
    let score = 0;
    for (const alias of type.aliases) {
      const needle = alias.trim().toLowerCase();
      if (!needle) continue;
      // Whole-phrase match; word-boundary aliases score higher than substrings.
      if (new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(haystack)) {
        score += needle.includes(' ') ? 3 : 2;
      } else if (needle.length >= 4 && haystack.includes(needle)) {
        score += 1;
      }
    }
    if (score > 0) scores.set(type.id, score);
  }

  const hasRecency = RECENCY_WORDS.some(word => haystack.includes(word));
  const hasListCount = /\b(top\s*)?(\d{1,2})\b/.test(haystack) && /top|best|worst|list|ranked/.test(haystack);

  if (hasListCount) scores.set('listicle', (scores.get('listicle') || 0) + 3);
  if (hasRecency && /news|update|announced|released|latest|breaking/.test(haystack)) {
    scores.set('news', (scores.get('news') || 0) + 3);
  }

  let best = null;
  let second = 0;
  for (const [id, score] of scores.entries()) {
    if (!best || score > scores.get(best)) {
      if (best) second = Math.max(second, scores.get(best));
      best = id;
    }
  }

  const typeId = best || 'explainer';
  const topScore = scores.get(typeId) || 0;
  const confidence = best ? Math.min(0.95, 0.45 + topScore * 0.08 + (topScore > second ? 0.1 : 0)) : 0.4;

  return {
    typeId,
    confidence: Number(confidence.toFixed(2)),
    evidence: {
      matchedAliases: [...scores.entries()].map(([id, score]) => ({ id, score })),
      recencySignals: hasRecency,
      listCountSignal: hasListCount
    }
  };
}

function buildClassification(type, classifierPath, confidence, evidence = {}) {
  return {
    contentType: type.label,
    typeId: type.id,
    confidence: Number(confidence ?? 0.6),
    classifier: classifierPath,
    aspectRatio: type.aspectRatio || '16:9',
    researchStrategy: type.researchStrategy,
    scriptStructure: type.scriptStructure,
    visualStrategy: type.visualStrategy,
    narrationStyle: type.narrationStyle,
    pacingStyle: type.pacingStyle,
    editingStyle: type.editingStyle,
    thumbnailStrategy: type.thumbnailStrategy,
    seoStrategy: type.seoStrategy,
    classificationEvidence: evidence
  };
}

class ContentClassifier {
  constructor(aiTextService, options = {}) {
    this.ai = aiTextService || null;
    this.logger = options.logger || new Logger('ContentClassifier');
  }

  /**
   * Classify a topic into a content type with a complete production strategy.
   * Never throws: on total failure returns the heuristic explainer baseline.
   */
  async classify(request = {}) {
    const { topic = '', instructions = '', audience = '', channelStyle = null, explicitType = null } = request;

    // 1. Operator override always wins.
    if (explicitType && KNOWN_TYPE_IDS.has(String(explicitType).toLowerCase())) {
      const type = resolveContentType(String(explicitType).toLowerCase());
      return buildClassification(type, 'operator', 1.0, { operatorOverride: explicitType });
    }

    const heuristic = heuristicClassify({ topic, instructions, audience });

    // 2. AI path (best-effort).
    let aiType = null;
    let aiConfidence = null;
    if (this.ai && typeof this.ai.isAvailable === 'function' && this.ai.isAvailable()) {
      try {
        aiType = await this.askAI({ topic, instructions, audience, channelStyle });
      } catch (error) {
        this.logger.warn('AI classification unavailable, using heuristics:', error.message);
      }
    }

    if (aiType && KNOWN_TYPE_IDS.has(aiType.typeId)) {
      aiConfidence = Number(aiType.confidence);
      if (!(aiConfidence >= 0 && aiConfidence <= 1)) aiConfidence = 0.6;
      const type = resolveContentType(aiType.typeId);
      // Prefer AI when it is reasonably confident; keep heuristic evidence.
      if (aiConfidence >= Math.max(0.55, heuristic.confidence - 0.15)) {
        return buildClassification(type, 'ai', aiConfidence, {
          aiReasoning: aiType.reasoning || null,
          heuristicRunnerUp: heuristic.typeId,
          heuristicEvidence: heuristic.evidence
        });
      }
    }

    // 3. Heuristic decision.
    const type = resolveContentType(heuristic.typeId);
    return buildClassification(type, 'heuristic', heuristic.confidence, {
      heuristicEvidence: heuristic.evidence,
      aiAttempted: Boolean(this.ai),
      aiSuggestion: aiType ? aiType.typeId : null
    });
  }

  async askAI({ topic, instructions, audience, channelStyle }) {
    const typeList = listContentTypeIds({ includeCustom: true }).join(', ');
    const prompt = `Classify a YouTube video request into exactly one content type.

CONTENT TYPES: ${typeList}

TOPIC: ${topic}
INSTRUCTIONS: ${instructions || '(none)'}
TARGET AUDIENCE: ${audience || '(unspecified)'}
CHANNEL STYLE: ${channelStyle ? JSON.stringify(channelStyle).slice(0, 400) : '(unspecified)'}

Rules:
- Respond with ONLY a JSON object, no markdown fences.
- typeId must be one of the listed content types.
- confidence is 0.0-1.0 reflecting how certain the classification is.
- reasoning is one short sentence.

{"typeId":"<type>","confidence":0.0,"reasoning":"<sentence>"}`;

    const raw = await this.ai.generateText(prompt, { maxTokens: 200, temperature: 0.2 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('classifier returned no JSON object');
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed.typeId !== 'string') throw new Error('classifier JSON missing typeId');
    return {
      typeId: parsed.typeId.toLowerCase().trim(),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null
    };
  }

  /** Map the legacy strategy.format value onto the new type system. */
  static fromLegacyFormat(format) {
    return LEGACY_FORMAT_MAP[String(format || '').toLowerCase()] || null;
  }
}

module.exports = { ContentClassifier, heuristicClassify, buildClassification, KNOWN_TYPE_IDS, LEGACY_FORMAT_MAP };
