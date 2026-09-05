const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');

class ThumbnailDesignerAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ThumbnailDesigner');
    this.templatesPath = path.join(__dirname, '..', 'data', 'thumbnail-templates');
  }

  async initialize() {
    this.logger.info('Initializing Thumbnail Designer Agent...');
    await this.ensureTemplatesDirectory();
    return true;
  }

  async ensureTemplatesDirectory() {
    try {
      await fs.mkdir(this.templatesPath, { recursive: true });
      await fs.mkdir(path.join(__dirname, '..', 'uploads', 'thumbnails'), { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create directories:', error);
    }
  }

  async generateThumbnail(script) {
    try {
      this.logger.info(`Generating thumbnail for: ${script.title}`);
      
      // Generate thumbnail concept
      const concept = await this.generateConcept(script);
      
      // Create thumbnail prompt for AI generation
      const prompt = await this.createPrompt(concept);
      
      // Generate base thumbnail
      const thumbnailPath = await this.createThumbnail(concept);
      
      // Add text overlay
      const finalThumbnail = await this.addTextOverlay(thumbnailPath, concept);
      
      // Optimize for YouTube
      const optimizedThumbnail = await this.optimizeForYouTube(finalThumbnail);
      
      const thumbnailData = {
        path: optimizedThumbnail,
        concept,
        prompt,
        dimensions: { width: 1280, height: 720 },
        fileSize: await this.getFileSize(optimizedThumbnail),
        createdAt: new Date().toISOString()
      };
      
      // Save to database
      await this.db.saveThumbnail(thumbnailData);
      
      this.logger.info('Thumbnail generated successfully');
      return thumbnailData;
    } catch (error) {
      this.logger.error('Failed to generate thumbnail:', error);
      throw error;
    }
  }

  async generateConcept(script) {
    const concepts = {
      tutorial: {
        style: 'clean',
        elements: ['step numbers', 'arrows', 'progress indicators'],
        colors: ['blue', 'white', 'green'],
        emotion: 'helpful'
      },
      explainer: {
        style: 'informative',
        elements: ['icons', 'diagrams', 'question marks'],
        colors: ['purple', 'yellow', 'white'],
        emotion: 'curious'
      },
      list: {
        style: 'numbered',
        elements: ['large numbers', 'countdown', 'highlights'],
        colors: ['red', 'yellow', 'black'],
        emotion: 'exciting'
      },
      review: {
        style: 'comparative',
        elements: ['product image', 'rating stars', 'vs symbol'],
        colors: ['orange', 'gray', 'white'],
        emotion: 'analytical'
      },
      story: {
        style: 'dramatic',
        elements: ['faces', 'emotion', 'journey path'],
        colors: ['dark blue', 'gold', 'white'],
        emotion: 'intriguing'
      }
    };

    // Content-type aware concept: the classifier's thumbnailStrategy wins;
    // legacy 5-format contentType keys still work unchanged.
    const classification = script.metadata?.strategy?.classification;
    const typeConcept = classification ? this.conceptForType(classification) : null;
    const baseConcept = typeConcept
      || concepts[script.metadata?.strategy?.contentType?.toLowerCase()]
      || concepts.explainer;
    const maxTextWords = typeConcept?.maxTextWords || 5;
    
    return {
      title: this.formatThumbnailTitle(script.title, maxTextWords),
      style: baseConcept.style,
      primaryText: this.extractPrimaryText(script.title),
      secondaryText: this.generateSecondaryText(script),
      elements: baseConcept.elements,
      colors: {
        primary: baseConcept.colors[0],
        secondary: baseConcept.colors[1],
        accent: baseConcept.colors[2]
      },
      emotion: baseConcept.emotion,
      composition: this.selectComposition(),
      effects: this.selectEffects()
    };
  }

  formatThumbnailTitle(title, maxWords = 5) {
    // Shorten title for thumbnail (content type may cap it tighter)
    const words = String(title || '').split(' ');
    const cap = Math.max(2, Number(maxWords) || 5);
    if (words.length > cap) {
      return words.slice(0, cap).join(' ') + '...';
    }
    return title;
  }

  /**
   * Map a 30-type classification to a thumbnail concept using its
   * thumbnailStrategy (layout, palette, maxTextWords, accent).
   */
  conceptForType(classification) {
    const strategy = classification?.thumbnailStrategy;
    if (!strategy) return null;
    const palettes = {
      'news-red': ['#e53935', '#111318', '#ffffff'],
      'sec-red': ['#ff5252', '#0b0b12', '#ffffff'],
      'rank-gold': ['#f6b73c', '#141414', '#ffffff'],
      'pop-yellow': ['#ffd54f', '#101010', '#111318'],
      'tech-cyan': ['#26c6da', '#0d1520', '#ffffff'],
      'ai-violet': ['#7c4dff', '#120a24', '#ffffff'],
      'lab-green': ['#66bb6a', '#0e1a12', '#ffffff'],
      'money-green': ['#43a047', '#0c1a10', '#ffffff'],
      'review-orange': ['#fb8c00', '#171310', '#ffffff'],
      'app-blue': ['#42a5f5', '#0e1620', '#ffffff'],
      'guide-green': ['#4caf50', '#0f1a10', '#ffffff'],
      'warn-amber': ['#ffb300', '#1a1408', '#111318'],
      'film-teal': ['#26a69a', '#0c1719', '#ffffff'],
      'noir': ['#9e9e9e', '#0a0a0a', '#ffffff'],
      'blood-dark': ['#b71c1c', '#070608', '#ffffff'],
      'neon': ['#00e5ff', '#05070f', '#ff2ea6'],
      'sunset': ['#ff7043', '#1c0f14', '#ffe0b2'],
      'dawn-gold': ['#ffca28', '#151208', '#ffffff'],
      'duo-split': ['#ab47bc', '#101018', '#ffffff'],
      'editorial-navy': ['#3949ab', '#0c0f1d', '#ffffff'],
      'case-blue': ['#1e88e5', '#0a1220', '#ffffff'],
      'host-red': ['#ef5350', '#140b0b', '#ffffff'],
      'shorts-neon': ['#ff005d', '#0a0510', '#00e5ff'],
      'trend-purple': ['#8e24aa', '#120818', '#ffffff'],
      'warm-film': ['#ff8a65', '#160f0c', '#ffffff'],
      'trust-blue': ['#1e88e5', '#0b1220', '#ffffff'],
      'deep-indigo': ['#5c6bc0', '#0d0f1e', '#ffffff'],
      'cinematic': ['#455a64', '#0b0e10', '#ffffff'],
      'vibrant': ['#d500f9', '#0e0614', '#ffffff'],
      'alert': ['#e53935', '#120808', '#ffd54f'],
      'bold': ['#fdd835', '#101010', '#111318'],
      'neutral': ['#90a4ae', '#101418', '#ffffff']
    };
    const palette = palettes[strategy.accent] || ['#4a90d9', '#0f1420', '#ffffff'];
    return {
      style: strategy.layout || 'bold',
      elements: strategy.elements || ['strong subject', 'contrast'],
      colors: palette,
      emotion: strategy.emotion || 'engaging',
      layout: strategy.layout,
      maxTextWords: strategy.maxTextWords
    };
  }

  extractPrimaryText(title) {
    // Extract most impactful words
    const impactWords = ['ultimate', 'complete', 'secret', 'truth', 'how', 'why', 'best', 'top', 'guide', 'master'];
    const titleWords = title.toLowerCase().split(' ');
    
    const foundImpactWords = titleWords.filter(word => impactWords.includes(word));
    
    if (foundImpactWords.length > 0) {
      return foundImpactWords[0].toUpperCase();
    }
    
    // Extract numbers if present
    const numbers = title.match(/\d+/);
    if (numbers) {
      return numbers[0];
    }
    
    // Use first significant word
    return titleWords.find(word => word.length > 4)?.toUpperCase() || 'WATCH';
  }

  generateSecondaryText(script) {
    if (script.metadata && script.metadata.strategy) {
      const strategy = script.metadata.strategy;
      
      if (strategy.contentType === 'Tutorial') {
        return 'STEP BY STEP';
      } else if (strategy.contentType === 'List') {
        return 'YOU WON\'T BELIEVE #1';
      } else if (strategy.contentType === 'Review') {
        return 'HONEST REVIEW';
      }
    }
    
    return 'MUST WATCH';
  }

  selectComposition() {
    const compositions = [
      'rule-of-thirds',
      'centered',
      'diagonal',
      'golden-ratio',
      'symmetrical'
    ];
    
    return compositions[Math.floor(Math.random() * compositions.length)];
  }

  selectEffects() {
    return {
      blur: Math.random() > 0.5,
      vignette: Math.random() > 0.7,
      glow: Math.random() > 0.6,
      shadow: true,
      border: Math.random() > 0.8
    };
  }

  async createPrompt(concept) {
    const prompt = `Create a YouTube thumbnail with the following specifications:
    Style: ${concept.style}
    Primary Text: "${concept.primaryText}"
    Secondary Text: "${concept.secondaryText}"
    Color Scheme: ${concept.colors.primary}, ${concept.colors.secondary}, ${concept.colors.accent}
    Elements to include: ${concept.elements.join(', ')}
    Emotional tone: ${concept.emotion}
    Composition: ${concept.composition}
    
    The thumbnail should be eye-catching, professional, and optimized for high click-through rate.
    Resolution: 1280x720px
    Format: High contrast, bold text, clear imagery`;
    
    return prompt;
  }

  async createThumbnail(concept, suffix = '') {
    // Create a base thumbnail using Sharp
    const width = 1280;
    const height = 720;
    
    const marker = suffix ? `_${suffix}` : '';
    const outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail${marker}_${Date.now()}.png`);
    
    // Create gradient background
    const svg = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${this.hexToRgb(concept.colors.primary)};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${this.hexToRgb(concept.colors.secondary)};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#gradient)" />
      </svg>
    `;
    
    await sharp(Buffer.from(svg))
      .resize(width, height)
      .png()
      .toFile(outputPath);
    
    return outputPath;
  }

  hexToRgb(color) {
    // Color name to hex mapping
    const colors = {
      'blue': '#0066CC',
      'red': '#CC0000',
      'green': '#00CC66',
      'yellow': '#FFCC00',
      'purple': '#6600CC',
      'orange': '#FF6600',
      'white': '#FFFFFF',
      'black': '#000000',
      'gray': '#808080',
      'dark blue': '#003366',
      'gold': '#FFD700'
    };
    
    return colors[color] || '#000000';
  }

  async addTextOverlay(imagePath, concept, suffix = '') {
    const marker = suffix ? `_${suffix}` : '';
    const outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_final${marker}_${Date.now()}.png`);
    
    // Create text overlay SVG
    const textSvg = `
      <svg width="1280" height="720">
        <style>
          .primary { 
            fill: ${concept.colors.accent === 'white' ? 'white' : 'black'}; 
            font-size: 120px; 
            font-weight: bold; 
            font-family: Arial, sans-serif;
            text-anchor: middle;
          }
          .secondary { 
            fill: ${concept.colors.accent}; 
            font-size: 60px; 
            font-weight: bold; 
            font-family: Arial, sans-serif;
            text-anchor: middle;
          }
          .shadow {
            fill: black;
            opacity: 0.5;
          }
        </style>
        
        <!-- Shadow -->
        <text x="642" y="302" class="primary shadow">${concept.primaryText}</text>
        <text x="642" y="402" class="secondary shadow">${concept.secondaryText}</text>
        
        <!-- Main text -->
        <text x="640" y="300" class="primary">${concept.primaryText}</text>
        <text x="640" y="400" class="secondary">${concept.secondaryText}</text>
      </svg>
    `;
    
    const textOverlay = await sharp(Buffer.from(textSvg)).png().toBuffer();
    
    await sharp(imagePath)
      .composite([{
        input: textOverlay,
        top: 0,
        left: 0
      }])
      .toFile(outputPath);
    
    return outputPath;
  }

  async optimizeForYouTube(imagePath, suffix = '') {
    const marker = suffix ? `_${suffix}` : '';
    const outputPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_optimized${marker}_${Date.now()}.jpg`);
    
    // YouTube optimization: JPEG format, proper compression
    await sharp(imagePath)
      .resize(1280, 720, {
        fit: 'cover',
        position: 'centre'
      })
      .jpeg({
        quality: 90,
        progressive: true,
        optimizeScans: true
      })
      .toFile(outputPath);
    
    // Verify file size (YouTube limit is 2MB)
    const stats = await fs.stat(outputPath);
    if (stats.size > 2 * 1024 * 1024) {
      // Re-compress if too large
      await sharp(imagePath)
        .resize(1280, 720)
        .jpeg({ quality: 80 })
        .toFile(outputPath);
    }
    
    return outputPath;
  }

  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  async generateABVariants(concept) {
    const concepts = [
      {
        label: 'Color contrast',
        concept: {
          ...concept,
          colors: {
            primary: concept.colors.secondary,
            secondary: concept.colors.primary,
            accent: concept.colors.accent
          }
        }
      },
      {
        label: 'Alternate promise',
        concept: { ...concept, primaryText: this.generateAlternativeText(concept.primaryText) }
      },
      {
        label: 'Centered composition',
        concept: { ...concept, composition: 'centered' }
      }
    ];
    const variants = [];
    for (let index = 0; index < concepts.length; index++) {
      const { label, concept: variantConcept } = concepts[index];
      const suffix = `experiment_${index + 1}`;
      const base = await this.createThumbnail(variantConcept, suffix);
      const overlay = await this.addTextOverlay(base, variantConcept, suffix);
      const optimized = await this.optimizeForYouTube(overlay, suffix);
      variants.push({ label, path: optimized, concept: variantConcept });
    }
    return variants;
  }

  generateAlternativeText(originalText) {
    const alternatives = {
      'HOW': 'WHY',
      'BEST': 'TOP',
      'GUIDE': 'SECRETS',
      'TRUTH': 'FACTS',
      'ULTIMATE': 'COMPLETE'
    };
    
    return alternatives[originalText] || originalText + '!';
  }
}

module.exports = { ThumbnailDesignerAgent };
