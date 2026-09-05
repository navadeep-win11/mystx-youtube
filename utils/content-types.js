/**
 * Content Type Registry — the strategy layer for the general-purpose platform.
 *
 * Each content type declares HOW the pipeline should produce the video:
 * research strategy, script structure, visual plan, narration style, pacing,
 * editing style, thumbnail strategy and SEO strategy. Adding a new content
 * type means adding one entry here — no pipeline rewrites.
 *
 * The registry is data-only so it can be unit-tested without network/DB.
 */

const CONTENT_TYPES = {
  explainer: {
    id: 'explainer',
    label: 'Explainer / Educational',
    aliases: ['educational', 'explain', 'how does', 'what is', 'guide'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'introduction', 'problem', 'explanation', 'examples', 'recap', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'stock_image', 'diagram'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'concept'
    },
    narrationStyle: { tone: 'clear-teacher', paceWordsPerMinute: 150, person: 'third' },
    pacingStyle: { avgSceneSeconds: 12, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['lower_third', 'callout', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'educational'
    },
    thumbnailStrategy: { layout: 'subject_text', maxTextWords: 4, palette: 'trust-blue' },
    seoStrategy: { keywordStyle: 'question', chapters: true, hashtagCount: 3 }
  },

  news: {
    id: 'news',
    label: 'News / Current Events',
    aliases: ['news', 'latest', 'breaking', 'today', 'update', 'announced', 'released'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube', 'recency'], recencyWindowDays: 7 },
    scriptStructure: ['hook', 'headline', 'context', 'details', 'impact', 'outlook', 'cta'],
    visualStrategy: {
      bRollRatio: 0.7,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'pan',
      diagramFriendly: false,
      lowerThirds: 'source_card'
    },
    narrationStyle: { tone: 'reporter', paceWordsPerMinute: 165, person: 'third' },
    pacingStyle: { avgSceneSeconds: 7, cutStyle: 'fast', transition: 'cut' },
    editingStyle: {
      overlays: ['source_card', 'timestamp', 'lower_third', 'progress'],
      captions: 'phrase',
      titleCards: 'headline',
      accent: 'news-red'
    },
    thumbnailStrategy: { layout: 'headline_subject', maxTextWords: 5, palette: 'alert' },
    seoStrategy: { keywordStyle: 'entity+recency', chapters: false, hashtagCount: 4 }
  },

  trending: {
    id: 'trending',
    label: 'Trending Topics',
    aliases: ['trending', 'viral', 'hot', 'buzz'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube', 'recency'], recencyWindowDays: 3 },
    scriptStructure: ['hook', 'context', 'why_now', 'details', 'reactions', 'takeaway', 'cta'],
    visualStrategy: {
      bRollRatio: 0.6,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'zoom_in',
      diagramFriendly: false,
      lowerThirds: 'context_card'
    },
    narrationStyle: { tone: 'energetic-host', paceWordsPerMinute: 170, person: 'second' },
    pacingStyle: { avgSceneSeconds: 6, cutStyle: 'fast', transition: 'whip' },
    editingStyle: {
      overlays: ['context_card', 'progress', 'lower_third'],
      captions: 'phrase',
      titleCards: 'minimal',
      accent: 'trend-purple'
    },
    thumbnailStrategy: { layout: 'reaction_subject', maxTextWords: 4, palette: 'vibrant' },
    seoStrategy: { keywordStyle: 'entity+recency', chapters: false, hashtagCount: 4 }
  },

  listicle: {
    id: 'listicle',
    label: 'Top 10 / Listicle',
    aliases: ['top 10', 'top 5', 'top 7', 'list', 'best', 'ranked', 'countdown'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: 90 },
    scriptStructure: ['hook', 'criteria', 'list_items', 'bonus_item', 'summary', 'cta'],
    visualStrategy: {
      bRollRatio: 0.4,
      preferredAssetTypes: ['stock_image', 'screenshot', 'stock_video'],
      motionDefault: 'zoom_in',
      diagramFriendly: false,
      lowerThirds: 'item_card'
    },
    narrationStyle: { tone: 'upbeat-host', paceWordsPerMinute: 160, person: 'second' },
    pacingStyle: { avgSceneSeconds: 8, cutStyle: 'quick', transition: 'slide' },
    editingStyle: {
      overlays: ['number_badge', 'item_card', 'progress'],
      captions: 'sentence',
      titleCards: 'countdown',
      accent: 'rank-gold'
    },
    thumbnailStrategy: { layout: 'number_grid', maxTextWords: 5, palette: 'bold' },
    seoStrategy: { keywordStyle: 'list-intent', chapters: true, hashtagCount: 3 }
  },

  documentary: {
    id: 'documentary',
    label: 'Documentary',
    aliases: ['documentary', 'history of', 'rise and fall', 'the story behind', 'untold'],
    researchStrategy: { depth: 'deep', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['cold_open', 'prologue', 'act1', 'act2', 'act3', 'epilogue', 'cta'],
    visualStrategy: {
      bRollRatio: 0.75,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'slow_ken_burns',
      diagramFriendly: false,
      lowerThirds: 'chapter_card'
    },
    narrationStyle: { tone: 'cinematic-narrator', paceWordsPerMinute: 135, person: 'third' },
    pacingStyle: { avgSceneSeconds: 18, cutStyle: 'slow', transition: 'fade' },
    editingStyle: {
      overlays: ['chapter_card', 'map_pin', 'timeline'],
      captions: 'sentence',
      titleCards: 'cinematic',
      accent: 'film-teal'
    },
    thumbnailStrategy: { layout: 'single_subject', maxTextWords: 3, palette: 'cinematic' },
    seoStrategy: { keywordStyle: 'topic+depth', chapters: true, hashtagCount: 2 }
  },

  deep_dive: {
    id: 'deep_dive',
    label: 'Deep Dive',
    aliases: ['deep dive', 'in depth', 'everything about', 'masterclass'],
    researchStrategy: { depth: 'deep', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'frame', 'fundamentals', 'mechanics', 'nuances', 'implications', 'cta'],
    visualStrategy: {
      bRollRatio: 0.45,
      preferredAssetTypes: ['diagram', 'stock_video', 'screenshot'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'concept'
    },
    narrationStyle: { tone: 'expert-analyst', paceWordsPerMinute: 145, person: 'third' },
    pacingStyle: { avgSceneSeconds: 15, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['diagram_callout', 'progress', 'lower_third'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'deep-indigo'
    },
    thumbnailStrategy: { layout: 'diagram_subject', maxTextWords: 4, palette: 'deep-indigo' },
    seoStrategy: { keywordStyle: 'long-tail', chapters: true, hashtagCount: 3 }
  },

  storytelling: {
    id: 'storytelling',
    label: 'Storytelling',
    aliases: ['story of', 'narrative', 'tale', 'journey of'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'setup', 'conflict', 'journey', 'climax', 'resolution', 'lesson', 'cta'],
    visualStrategy: {
      bRollRatio: 0.7,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'slow_ken_burns',
      diagramFriendly: false,
      lowerThirds: 'none'
    },
    narrationStyle: { tone: 'storyteller', paceWordsPerMinute: 140, person: 'third' },
    pacingStyle: { avgSceneSeconds: 14, cutStyle: 'slow', transition: 'fade' },
    editingStyle: {
      overlays: ['quote_card'],
      captions: 'sentence',
      titleCards: 'cinematic',
      accent: 'warm-film'
    },
    thumbnailStrategy: { layout: 'emotional_subject', maxTextWords: 3, palette: 'warm-film' },
    seoStrategy: { keywordStyle: 'narrative-intent', chapters: false, hashtagCount: 2 }
  },

  mystery: {
    id: 'mystery',
    label: 'Mystery',
    aliases: ['mystery', 'unsolved', 'strange', 'unexplained', 'bizarre'],
    researchStrategy: { depth: 'deep', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'incident', 'investigation', 'theories', 'evidence', 'unresolved', 'cta'],
    visualStrategy: {
      bRollRatio: 0.6,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'slow_zoom',
      diagramFriendly: true,
      lowerThirds: 'evidence_card'
    },
    narrationStyle: { tone: 'hushed-narrator', paceWordsPerMinute: 130, person: 'third' },
    pacingStyle: { avgSceneSeconds: 13, cutStyle: 'slow', transition: 'fade' },
    editingStyle: {
      overlays: ['evidence_card', 'map_pin'],
      captions: 'sentence',
      titleCards: 'cinematic',
      accent: 'noir'
    },
    thumbnailStrategy: { layout: 'shadow_subject', maxTextWords: 3, palette: 'noir' },
    seoStrategy: { keywordStyle: 'curiosity-gap', chapters: false, hashtagCount: 3 }
  },

  horror_unsolved: {
    id: 'horror_unsolved',
    label: 'Horror / Unsolved',
    aliases: ['horror', 'scary', 'creepy', 'disappearance', 'haunting', 'true crime'],
    researchStrategy: { depth: 'deep', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'normalcy', 'event', 'descent', 'horror', 'aftermath', 'cta'],
    visualStrategy: {
      bRollRatio: 0.55,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'creepy_zoom',
      diagramFriendly: false,
      lowerThirds: 'date_card'
    },
    narrationStyle: { tone: 'chilling-narrator', paceWordsPerMinute: 125, person: 'third' },
    pacingStyle: { avgSceneSeconds: 12, cutStyle: 'uneven', transition: 'glitch' },
    editingStyle: {
      overlays: ['date_card', 'quote_card'],
      captions: 'sentence',
      titleCards: 'distressed',
      accent: 'blood-dark'
    },
    thumbnailStrategy: { layout: 'sinister_subject', maxTextWords: 3, palette: 'blood-dark' },
    seoStrategy: { keywordStyle: 'fear+curiosity', chapters: false, hashtagCount: 3 }
  },

  facts: {
    id: 'facts',
    label: 'Facts / Interesting Facts',
    aliases: ['facts', 'did you know', 'amazing facts', 'interesting'],
    researchStrategy: { depth: 'fast', prioritySources: ['evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'fact_block', 'fact_block', 'fact_block', 'fact_block', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_image', 'stock_video', 'diagram'],
      motionDefault: 'zoom_in',
      diagramFriendly: true,
      lowerThirds: 'fact_card'
    },
    narrationStyle: { tone: 'rapid-host', paceWordsPerMinute: 175, person: 'second' },
    pacingStyle: { avgSceneSeconds: 6, cutStyle: 'quick', transition: 'slide' },
    editingStyle: {
      overlays: ['fact_card', 'progress'],
      captions: 'phrase',
      titleCards: 'minimal',
      accent: 'pop-yellow'
    },
    thumbnailStrategy: { layout: 'fact_shock', maxTextWords: 5, palette: 'pop-yellow' },
    seoStrategy: { keywordStyle: 'curiosity', chapters: false, hashtagCount: 4 }
  },

  technology: {
    id: 'technology',
    label: 'Technology',
    aliases: ['technology', 'tech', 'gadget', 'hardware', 'software', 'smartphone', 'device'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 60 },
    scriptStructure: ['hook', 'landscape', 'core_tech', 'use_cases', 'limitations', 'future', 'cta'],
    visualStrategy: {
      bRollRatio: 0.6,
      preferredAssetTypes: ['screenshot', 'stock_video', 'diagram'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'spec_card'
    },
    narrationStyle: { tone: 'knowledgeable-reviewer', paceWordsPerMinute: 155, person: 'third' },
    pacingStyle: { avgSceneSeconds: 10, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['spec_card', 'callout', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'tech-cyan'
    },
    thumbnailStrategy: { layout: 'product_ui', maxTextWords: 4, palette: 'tech-cyan' },
    seoStrategy: { keywordStyle: 'product+feature', chapters: true, hashtagCount: 3 }
  },

  ai: {
    id: 'ai',
    label: 'AI',
    aliases: ['ai', 'artificial intelligence', 'machine learning', 'llm', 'neural', 'chatbot', 'gpt', 'gemini'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 30 },
    scriptStructure: ['hook', 'context', 'capability', 'how_it_works', 'applications', 'risks', 'cta'],
    visualStrategy: {
      bRollRatio: 0.55,
      preferredAssetTypes: ['screenshot', 'stock_video', 'diagram'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'concept'
    },
    narrationStyle: { tone: 'clear-analyst', paceWordsPerMinute: 155, person: 'third' },
    pacingStyle: { avgSceneSeconds: 10, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['diagram_callout', 'spec_card', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'ai-violet'
    },
    thumbnailStrategy: { layout: 'ui_subject', maxTextWords: 4, palette: 'ai-violet' },
    seoStrategy: { keywordStyle: 'topic+ai', chapters: true, hashtagCount: 3 }
  },

  cybersecurity: {
    id: 'cybersecurity',
    label: 'Cybersecurity',
    aliases: ['cybersecurity', 'cybersec', 'infosec', 'security', 'hack', 'phishing', 'malware', 'ransomware', 'encryption', 'cve', 'vulnerability', 'data breach'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 30 },
    scriptStructure: ['hook', 'threat_landscape', 'how_it_works', 'real_world_impact', 'defense', 'checklist', 'cta'],
    visualStrategy: {
      bRollRatio: 0.55,
      preferredAssetTypes: ['stock_video', 'diagram', 'screenshot'],
      motionDefault: 'pan',
      diagramFriendly: true,
      lowerThirds: 'threat_card'
    },
    narrationStyle: { tone: 'sober-analyst', paceWordsPerMinute: 150, person: 'second' },
    pacingStyle: { avgSceneSeconds: 11, cutStyle: 'deliberate', transition: 'cut' },
    editingStyle: {
      overlays: ['threat_card', 'diagram_callout', 'checklist', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'sec-red'
    },
    thumbnailStrategy: { layout: 'threat_subject', maxTextWords: 4, palette: 'sec-red' },
    seoStrategy: { keywordStyle: 'threat+defense', chapters: true, hashtagCount: 4 }
  },

  science: {
    id: 'science',
    label: 'Science',
    aliases: ['science', 'physics', 'biology', 'chemistry', 'space', 'quantum', 'research'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'question', 'background', 'experiment', 'findings', 'meaning', 'cta'],
    visualStrategy: {
      bRollRatio: 0.6,
      preferredAssetTypes: ['stock_video', 'diagram', 'stock_image'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'concept'
    },
    narrationStyle: { tone: 'curious-scientist', paceWordsPerMinute: 145, person: 'third' },
    pacingStyle: { avgSceneSeconds: 12, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['diagram_callout', 'data_callout', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'lab-green'
    },
    thumbnailStrategy: { layout: 'wonder_subject', maxTextWords: 4, palette: 'lab-green' },
    seoStrategy: { keywordStyle: 'concept', chapters: true, hashtagCount: 3 }
  },

  finance: {
    id: 'finance',
    label: 'Finance / Business',
    aliases: ['finance', 'money', 'investing', 'business', 'stocks', 'crypto', 'economy', 'budget'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 30 },
    scriptStructure: ['hook', 'context', 'mechanism', 'cases', 'numbers', 'risks', 'takeaway', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'diagram', 'stock_image'],
      motionDefault: 'pan',
      diagramFriendly: true,
      lowerThirds: 'figure_card'
    },
    narrationStyle: { tone: 'measured-advisor', paceWordsPerMinute: 150, person: 'second' },
    pacingStyle: { avgSceneSeconds: 11, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['figure_card', 'chart_callout', 'disclaimer'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'money-green'
    },
    thumbnailStrategy: { layout: 'number_subject', maxTextWords: 4, palette: 'money-green' },
    seoStrategy: { keywordStyle: 'intent+entity', chapters: true, hashtagCount: 3 }
  },

  gaming: {
    id: 'gaming',
    label: 'Gaming',
    aliases: ['gaming', 'game', 'gameplay', 'esports', 'rpg', 'fps'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube'], recencyWindowDays: 60 },
    scriptStructure: ['hook', 'game_intro', 'gameplay', 'highlights', 'tips', 'verdict', 'cta'],
    visualStrategy: {
      bRollRatio: 0.4,
      preferredAssetTypes: ['screenshot', 'stock_image', 'stock_video'],
      motionDefault: 'zoom_in',
      diagramFriendly: false,
      lowerThirds: 'tip_card'
    },
    narrationStyle: { tone: 'hyped-player', paceWordsPerMinute: 170, person: 'second' },
    pacingStyle: { avgSceneSeconds: 7, cutStyle: 'fast', transition: 'whip' },
    editingStyle: {
      overlays: ['tip_card', 'score_card', 'progress'],
      captions: 'phrase',
      titleCards: 'bold',
      accent: 'neon'
    },
    thumbnailStrategy: { layout: 'action_face', maxTextWords: 4, palette: 'neon' },
    seoStrategy: { keywordStyle: 'game+mode', chapters: false, hashtagCount: 4 }
  },

  product_review: {
    id: 'product_review',
    label: 'Product Review',
    aliases: ['review', 'unboxing', 'hands on', 'worth it', 'tested'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 90 },
    scriptStructure: ['hook', 'intro_product', 'build', 'features', 'pros', 'cons', 'verdict', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'screenshot', 'stock_image'],
      motionDefault: 'orbit',
      diagramFriendly: false,
      lowerThirds: 'spec_card'
    },
    narrationStyle: { tone: 'honest-reviewer', paceWordsPerMinute: 155, person: 'first' },
    pacingStyle: { avgSceneSeconds: 10, cutStyle: 'smooth', transition: 'slide' },
    editingStyle: {
      overlays: ['spec_card', 'pro_con_card', 'score_badge', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'review-orange'
    },
    thumbnailStrategy: { layout: 'product_verdict', maxTextWords: 4, palette: 'review-orange' },
    seoStrategy: { keywordStyle: 'product+review', chapters: true, hashtagCount: 3 }
  },

  app_review: {
    id: 'app_review',
    label: 'App Review',
    aliases: ['app review', 'android app', 'ios app', 'application review', 'app demo'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube', 'recency'], recencyWindowDays: 60 },
    scriptStructure: ['hook', 'app_intro', 'ui_walkthrough', 'features', 'pricing', 'verdict', 'cta'],
    visualStrategy: {
      bRollRatio: 0.3,
      preferredAssetTypes: ['screenshot', 'stock_image'],
      motionDefault: 'ui_pan',
      diagramFriendly: false,
      lowerThirds: 'feature_card'
    },
    narrationStyle: { tone: 'friendly-guide', paceWordsPerMinute: 160, person: 'first' },
    pacingStyle: { avgSceneSeconds: 8, cutStyle: 'quick', transition: 'slide' },
    editingStyle: {
      overlays: ['feature_card', 'rating_badge', 'device_frame'],
      captions: 'sentence',
      titleCards: 'minimal',
      accent: 'app-blue'
    },
    thumbnailStrategy: { layout: 'app_ui', maxTextWords: 4, palette: 'app-blue' },
    seoStrategy: { keywordStyle: 'app+feature', chapters: true, hashtagCount: 3 }
  },

  tutorial: {
    id: 'tutorial',
    label: 'Tutorials / How-To',
    aliases: ['tutorial', 'how to', 'step by step', 'setup', 'install', 'beginners guide'],
    researchStrategy: { depth: 'balanced', prioritySources: ['evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'outcome', 'prerequisites', 'steps', 'troubleshooting', 'recap', 'cta'],
    visualStrategy: {
      bRollRatio: 0.35,
      preferredAssetTypes: ['screenshot', 'diagram', 'stock_video'],
      motionDefault: 'static_safe',
      diagramFriendly: true,
      lowerThirds: 'step_card'
    },
    narrationStyle: { tone: 'patient-instructor', paceWordsPerMinute: 140, person: 'second' },
    pacingStyle: { avgSceneSeconds: 14, cutStyle: 'steady', transition: 'cut' },
    editingStyle: {
      overlays: ['step_card', 'checklist', 'callout'],
      captions: 'sentence',
      titleCards: 'step',
      accent: 'guide-green'
    },
    thumbnailStrategy: { layout: 'result_steps', maxTextWords: 5, palette: 'guide-green' },
    seoStrategy: { keywordStyle: 'how-to', chapters: true, hashtagCount: 3 }
  },

  comparison: {
    id: 'comparison',
    label: 'Comparisons',
    aliases: ['vs', 'versus', 'compare', 'comparison', 'difference between', 'which is better'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'recency'], recencyWindowDays: 90 },
    scriptStructure: ['hook', 'contenders', 'criteria', 'head_to_head', 'tables', 'winner', 'cta'],
    visualStrategy: {
      bRollRatio: 0.35,
      preferredAssetTypes: ['screenshot', 'stock_image', 'diagram'],
      motionDefault: 'split_slide',
      diagramFriendly: true,
      lowerThirds: 'vs_card'
    },
    narrationStyle: { tone: 'balanced-analyst', paceWordsPerMinute: 155, person: 'third' },
    pacingStyle: { avgSceneSeconds: 9, cutStyle: 'quick', transition: 'slide' },
    editingStyle: {
      overlays: ['vs_card', 'table', 'score_badge', 'progress'],
      captions: 'sentence',
      titleCards: 'versus',
      accent: 'duo-split'
    },
    thumbnailStrategy: { layout: 'vs_layout', maxTextWords: 5, palette: 'duo-split' },
    seoStrategy: { keywordStyle: 'a-vs-b', chapters: true, hashtagCount: 3 }
  },

  ranking: {
    id: 'ranking',
    label: 'Rankings',
    aliases: ['ranking', 'tier list', 'leaderboard', 'worst', 'most'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: 180 },
    scriptStructure: ['hook', 'criteria', 'ranked_items', 'dishonorable_mention', 'number_one', 'cta'],
    visualStrategy: {
      bRollRatio: 0.35,
      preferredAssetTypes: ['stock_image', 'screenshot', 'diagram'],
      motionDefault: 'zoom_in',
      diagramFriendly: true,
      lowerThirds: 'rank_card'
    },
    narrationStyle: { tone: 'pundit', paceWordsPerMinute: 160, person: 'third' },
    pacingStyle: { avgSceneSeconds: 8, cutStyle: 'quick', transition: 'slide' },
    editingStyle: {
      overlays: ['rank_card', 'tier_badge', 'progress'],
      captions: 'sentence',
      titleCards: 'countdown',
      accent: 'rank-gold'
    },
    thumbnailStrategy: { layout: 'tier_list', maxTextWords: 4, palette: 'rank-gold' },
    seoStrategy: { keywordStyle: 'best-worst', chapters: true, hashtagCount: 3 }
  },

  case_study: {
    id: 'case_study',
    label: 'Case Studies',
    aliases: ['case study', 'how x did', 'anatomy of', 'post mortem', 'what happened to'],
    researchStrategy: { depth: 'deep', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'subject', 'situation', 'actions', 'results', 'lessons', 'cta'],
    visualStrategy: {
      bRollRatio: 0.6,
      preferredAssetTypes: ['stock_video', 'diagram', 'stock_image'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'result_card'
    },
    narrationStyle: { tone: 'analyst', paceWordsPerMinute: 145, person: 'third' },
    pacingStyle: { avgSceneSeconds: 13, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['result_card', 'chart_callout', 'timeline'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'case-blue'
    },
    thumbnailStrategy: { layout: 'subject_result', maxTextWords: 4, palette: 'case-blue' },
    seoStrategy: { keywordStyle: 'entity+outcome', chapters: true, hashtagCount: 3 }
  },

  commentary: {
    id: 'commentary',
    label: 'Commentary',
    aliases: ['commentary', 'react', 'thoughts on', 'responding to', 'drama'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube', 'recency'], recencyWindowDays: 14 },
    scriptStructure: ['hook', 'subject', 'position', 'arguments', 'counterpoints', 'conclusion', 'cta'],
    visualStrategy: {
      bRollRatio: 0.55,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'zoom_in',
      diagramFriendly: false,
      lowerThirds: 'quote_card'
    },
    narrationStyle: { tone: 'personal-host', paceWordsPerMinute: 165, person: 'first' },
    pacingStyle: { avgSceneSeconds: 8, cutStyle: 'quick', transition: 'cut' },
    editingStyle: {
      overlays: ['quote_card', 'reaction_frame', 'progress'],
      captions: 'phrase',
      titleCards: 'minimal',
      accent: 'host-red'
    },
    thumbnailStrategy: { layout: 'face_reaction', maxTextWords: 4, palette: 'host-red' },
    seoStrategy: { keywordStyle: 'entity+opinion', chapters: false, hashtagCount: 4 }
  },

  opinion: {
    id: 'opinion',
    label: 'Opinion / Analysis',
    aliases: ['opinion', 'analysis', 'why i think', 'my take', 'editorial'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: 60 },
    scriptStructure: ['hook', 'thesis', 'evidence', 'argument', 'counterargument', 'verdict', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['diagram', 'stock_video', 'stock_image'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'thesis_card'
    },
    narrationStyle: { tone: 'essayist', paceWordsPerMinute: 145, person: 'first' },
    pacingStyle: { avgSceneSeconds: 12, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['thesis_card', 'chart_callout', 'quote_card'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'editorial-navy'
    },
    thumbnailStrategy: { layout: 'authoritative_text', maxTextWords: 5, palette: 'editorial-navy' },
    seoStrategy: { keywordStyle: 'perspective', chapters: true, hashtagCount: 3 }
  },

  travel: {
    id: 'travel',
    label: 'Travel / Places',
    aliases: ['travel', 'visit', 'city', 'country', 'places to', 'tour', 'destination'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'arrival', 'highlights', 'hidden_gems', 'food_culture', 'practical_tips', 'cta'],
    visualStrategy: {
      bRollRatio: 0.8,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'slow_ken_burns',
      diagramFriendly: false,
      lowerThirds: 'location_card'
    },
    narrationStyle: { tone: 'warm-guide', paceWordsPerMinute: 140, person: 'second' },
    pacingStyle: { avgSceneSeconds: 12, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['location_card', 'map_pin', 'tip_card'],
      captions: 'sentence',
      titleCards: 'cinematic',
      accent: 'sunset'
    },
    thumbnailStrategy: { layout: 'vista_text', maxTextWords: 3, palette: 'sunset' },
    seoStrategy: { keywordStyle: 'destination+intent', chapters: true, hashtagCount: 3 }
  },

  motivation: {
    id: 'motivation',
    label: 'Motivation / Self Improvement',
    aliases: ['motivation', 'self improvement', 'discipline', 'habits', 'mindset', 'success'],
    researchStrategy: { depth: 'balanced', prioritySources: ['evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'pain', 'principle', 'evidence', 'practice', 'vision', 'cta'],
    visualStrategy: {
      bRollRatio: 0.65,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'slow_ken_burns',
      diagramFriendly: false,
      lowerThirds: 'principle_card'
    },
    narrationStyle: { tone: 'resonant-coach', paceWordsPerMinute: 135, person: 'second' },
    pacingStyle: { avgSceneSeconds: 10, cutStyle: 'slow', transition: 'fade' },
    editingStyle: {
      overlays: ['principle_card', 'quote_card'],
      captions: 'sentence',
      titleCards: 'cinematic',
      accent: 'dawn-gold'
    },
    thumbnailStrategy: { layout: 'subject_aspiration', maxTextWords: 3, palette: 'dawn-gold' },
    seoStrategy: { keywordStyle: 'aspiration', chapters: false, hashtagCount: 3 }
  },

  awareness: {
    id: 'awareness',
    label: 'Awareness / Alerts',
    aliases: ['warning', 'alert', 'scam', 'beware', 'danger', 'recall', 'outage'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube', 'recency'], recencyWindowDays: 7 },
    scriptStructure: ['hook', 'threat', 'who_is_affected', 'how_it_works', 'protect_yourself', 'spread_word', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'diagram'],
      motionDefault: 'zoom_in',
      diagramFriendly: true,
      lowerThirds: 'alert_card'
    },
    narrationStyle: { tone: 'urgent-civil', paceWordsPerMinute: 155, person: 'second' },
    pacingStyle: { avgSceneSeconds: 8, cutStyle: 'quick', transition: 'cut' },
    editingStyle: {
      overlays: ['alert_card', 'checklist', 'disclaimer'],
      captions: 'phrase',
      titleCards: 'warning',
      accent: 'warn-amber'
    },
    thumbnailStrategy: { layout: 'warning_symbol', maxTextWords: 5, palette: 'warn-amber' },
    seoStrategy: { keywordStyle: 'alert+protection', chapters: true, hashtagCount: 4 }
  },

  interview: {
    id: 'interview',
    label: 'Interviews / Q&A',
    aliases: ['interview', 'q&a', 'podcast', 'conversation with', 'ask me'],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['cold_open', 'intro_guest', 'questions', 'deep_questions', 'rapid_fire', 'close', 'cta'],
    visualStrategy: {
      bRollRatio: 0.4,
      preferredAssetTypes: ['stock_video', 'stock_image'],
      motionDefault: 'static_safe',
      diagramFriendly: false,
      lowerThirds: 'speaker_card'
    },
    narrationStyle: { tone: 'curious-host', paceWordsPerMinute: 150, person: 'mixed' },
    pacingStyle: { avgSceneSeconds: 15, cutStyle: 'smooth', transition: 'cut' },
    editingStyle: {
      overlays: ['speaker_card', 'question_card'],
      captions: 'sentence',
      titleCards: 'speaker',
      accent: 'studio-neutral'
    },
    thumbnailStrategy: { layout: 'two_face', maxTextWords: 4, palette: 'studio-neutral' },
    seoStrategy: { keywordStyle: 'guest+topic', chapters: true, hashtagCount: 3 }
  },

  shorts: {
    id: 'shorts',
    label: 'YouTube Shorts',
    aliases: ['shorts', 'short', 'vertical', 'quick tip'],
    researchStrategy: { depth: 'fast', prioritySources: ['youtube'], recencyWindowDays: 30 },
    scriptStructure: ['hook_2s', 'value_blocks', 'payoff', 'loop_cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'stock_image', 'screenshot'],
      motionDefault: 'punch_in',
      diagramFriendly: false,
      lowerThirds: 'none'
    },
    narrationStyle: { tone: 'high-energy', paceWordsPerMinute: 180, person: 'second' },
    pacingStyle: { avgSceneSeconds: 3, cutStyle: 'rapid', transition: 'cut' },
    editingStyle: {
      overlays: ['big_caption', 'emoji_badge'],
      captions: 'word',
      titleCards: 'none',
      accent: 'shorts-neon'
    },
    thumbnailStrategy: { layout: 'frame_zero', maxTextWords: 3, palette: 'shorts-neon' },
    seoStrategy: { keywordStyle: 'short-intent', chapters: false, hashtagCount: 5 },
    aspectRatio: '9:16'
  },

  custom: {
    id: 'custom',
    label: 'Custom Format',
    aliases: [],
    researchStrategy: { depth: 'balanced', prioritySources: ['youtube', 'evergreen'], recencyWindowDays: null },
    scriptStructure: ['hook', 'introduction', 'mainContent', 'conclusion', 'cta'],
    visualStrategy: {
      bRollRatio: 0.5,
      preferredAssetTypes: ['stock_video', 'stock_image', 'diagram'],
      motionDefault: 'ken_burns',
      diagramFriendly: true,
      lowerThirds: 'concept'
    },
    narrationStyle: { tone: 'neutral-host', paceWordsPerMinute: 150, person: 'third' },
    pacingStyle: { avgSceneSeconds: 10, cutStyle: 'smooth', transition: 'crossfade' },
    editingStyle: {
      overlays: ['lower_third', 'progress'],
      captions: 'sentence',
      titleCards: 'section',
      accent: 'neutral'
    },
    thumbnailStrategy: { layout: 'subject_text', maxTextWords: 4, palette: 'neutral' },
    seoStrategy: { keywordStyle: 'balanced', chapters: true, hashtagCount: 3 }
  }
};

/** Resolve a content type by id, alias phrase, or fall back to custom. */
function resolveContentType(idOrAlias) {
  // null/undefined is an explicit "no type requested" → custom meta format.
  if (idOrAlias === null || idOrAlias === undefined || idOrAlias === '') return CONTENT_TYPES.custom;
  const needle = String(idOrAlias).toLowerCase().trim();
  if (!needle) return CONTENT_TYPES.custom;
  if (CONTENT_TYPES[needle]) return CONTENT_TYPES[needle];
  for (const type of Object.values(CONTENT_TYPES)) {
    if (type.label.toLowerCase() === needle) return type;
    if (type.aliases.some(alias => alias.trim() === needle)) return type;
  }
  // Unknown ids/aliases resolve to null so callers can reject typos instead of
  // silently classifying as the custom meta format.
  return null;
}

/** All registered type ids ('custom' meta entry optional). */
function listContentTypeIds({ includeCustom = true } = {}) {
  return Object.keys(CONTENT_TYPES).filter(id => includeCustom || id !== 'custom');
}

module.exports = { CONTENT_TYPES, resolveContentType, listContentTypeIds };
