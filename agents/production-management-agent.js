const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { AIVideoGenerator } = require('../utils/ai-video-generator');
const { SceneRepairService } = require('../utils/scene-repair-service');

class ProductionManagementAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ProductionManagement');
    this.pipeline = [];
    this.assets = new Map();
    this.aiVideoGenerator = new AIVideoGenerator(credentials, { db });
    this.sceneRepair = new SceneRepairService(db, this.aiVideoGenerator, { logger: this.logger });
  }

  async initialize() {
    this.logger.info('Initializing Production Management Agent...');
    await this.setupDirectories();
    await this.loadPipeline();
    return true;
  }

  async setupDirectories() {
    const dirs = [
      'data/production',
      'data/assets',
      'data/videos',
      'data/audio',
      'data/scripts',
      'temp/processing'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(__dirname, '..', dir), { recursive: true });
    }
  }

  async loadPipeline() {
    try {
      const pipeline = await this.db.getProductionPipeline();
      this.pipeline = pipeline || [];
    } catch (error) {
      this.logger.warn('No existing pipeline found, starting fresh');
    }
  }

  async processContent(contentData) {
    try {
      this.logger.info('Processing content for production...');
      
      const { strategy, script, thumbnail, seo, jobId = null } = contentData;
      
      // Create production entry
      const productionId = this.generateProductionId();
      
      const productionData = {
        id: productionId,
        strategy,
        script,
        thumbnail,
        seo,
        status: 'processing',
        assets: {
          script: await this.processScript(script),
          thumbnail: await this.processThumbnail(thumbnail, script),
          audio: null, // Will be generated later
          video: null, // Will be generated later
          captions: null // Will be generated later
        },
        timeline: {
          created: new Date().toISOString(),
          scriptReady: new Date().toISOString(),
          thumbnailReady: new Date().toISOString(),
          audioGenerated: null,
          videoGenerated: null,
          captionsGenerated: null,
          readyForUpload: null
        },
        scheduledPublishTime: this.calculatePublishTime(strategy),
        priority: this.calculatePriority(strategy),
        estimatedDuration: script.duration,
        createdAt: new Date().toISOString()
      };
      productionData.jobId = jobId;
      
      // Add to pipeline
      this.pipeline.push(productionData);
      
      // Save to database
      await this.db.saveProductionData(productionData);
      
      // Professional pipeline (content-type aware): classification → visual plan →
      // narration timing → scene captions → composition. Each stage falls back
      // to the legacy path individually so existing behavior is preserved
      // whenever a stage fails.
      await this.processProfessionalPipeline(productionData);

      // Persist a scene-addressable production manifest for selective review and repair.
      await this.sceneRepair.initializeProduction(productionData, this.aiVideoGenerator.lastVideoResult || {});

      // Mark as ready — or simulated, when no real video could be produced
      const simulated = Boolean(productionData.assets.finalVideo?.simulated);
      if (simulated) {
        productionData.status = 'simulated';
        this.logger.warn(`Content ${productionId} produced PLACEHOLDER assets only — it will NOT be uploaded. Check your AI provider keys and FFmpeg installation.`);
      } else {
        productionData.status = 'ready';
        productionData.timeline.readyForUpload = new Date().toISOString();
      }

      await this.db.updateProductionData(productionData);

      this.logger.info(`Content processing complete: ${productionId} (status: ${productionData.status})`);
      return productionData;
    } catch (error) {
      this.logger.error('Failed to process content:', error);
      throw error;
    }
  }

  generateProductionId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const extra = Math.random().toString(36).substring(2, 15);
    return `prod_${timestamp}_${random}_${extra}`;
  }

  async processScript(script) {
    const scriptPath = path.join(__dirname, '..', 'data', 'scripts', `${Date.now()}_script.json`);
    
    // Create formatted script for TTS
    const ttsScript = this.formatScriptForTTS(script);
    
    // Save script files
    await fs.writeFile(scriptPath, JSON.stringify(script, null, 2));
    await fs.writeFile(
      scriptPath.replace('.json', '_tts.txt'), 
      ttsScript
    );
    
    return {
      originalPath: scriptPath,
      ttsPath: scriptPath.replace('.json', '_tts.txt'),
      duration: script.duration,
      sections: script.mainContent.sections.length
    };
  }

  formatScriptForTTS(script) {
    let ttsText = '';
    
    // Add hook
    if (script.hook) {
      ttsText += `${script.hook.text}\n\n`;
    }
    
    // Add introduction
    if (script.introduction) {
      ttsText += `${script.introduction.greeting}\n`;
      ttsText += `${script.introduction.topicIntro}\n`;
      ttsText += `${script.introduction.valueProposition}\n`;
      ttsText += `${script.introduction.credibility}\n\n`;
    }
    
    // Add main content
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        ttsText += `Section ${index + 1}: ${section.title}\n`;
        
        if (Array.isArray(section.content)) {
          section.content.forEach(line => {
            if (typeof line === 'string' && !line.startsWith('[')) {
              ttsText += `${line}\n`;
            }
          });
        } else if (section.steps) {
          section.steps.forEach(step => {
            ttsText += `${step.title}. ${step.description}\n`;
            ttsText += `${step.tip}\n`;
          });
        } else if (section.items) {
          section.items.forEach(item => {
            ttsText += `Number ${item.number}: ${item.title}. ${item.description}\n`;
          });
        } else if (typeof section.content === 'string') {
          ttsText += `${section.content}\n`;
        }
        
        ttsText += '\n';
      });
    }
    
    // Add conclusion
    if (script.conclusion) {
      script.conclusion.recap.forEach(line => {
        if (typeof line === 'string') {
          ttsText += `${line}\n`;
        }
      });
      ttsText += `\n${script.conclusion.finalThought}\n\n`;
    }
    
    // Add CTA
    if (script.callToAction) {
      ttsText += `${script.callToAction.subscribe}\n`;
      ttsText += `${script.callToAction.like}\n`;
      ttsText += `${script.callToAction.comment}\n`;
    }
    
    return ttsText;
  }

  async processThumbnail(thumbnail, script) {
    try {
      // Try to generate AI thumbnail first
      const thumbnailScript = thumbnail.script || script || { title: thumbnail.title || 'Untitled Video' };
      const aiThumbnail = await this.aiVideoGenerator.generateThumbnail(thumbnailScript, 'ethereal');
      
      return {
        path: aiThumbnail.path,
        originalPath: thumbnail.path,
        dimensions: aiThumbnail.dimensions,
        fileSize: aiThumbnail.fileSize,
        generatedWith: 'AI'
      };
    } catch (error) {
      this.logger.error('AI thumbnail generation failed:', error);
      
      // Fallback to original processing
      const productionThumbnailPath = path.join(
        __dirname, '..', 'data', 'assets', 
        `thumbnail_${Date.now()}.jpg`
      );
      
      if (thumbnail.path && await fs.access(thumbnail.path).then(() => true).catch(() => false)) {
        const originalBuffer = await fs.readFile(thumbnail.path);
        await fs.writeFile(productionThumbnailPath, originalBuffer);
      } else {
        // Create placeholder
        await fs.writeFile(productionThumbnailPath + '.placeholder', 'Thumbnail placeholder');
      }
      
      return {
        path: productionThumbnailPath,
        originalPath: thumbnail.path,
        dimensions: thumbnail.dimensions || { width: 1792, height: 1024 },
        fileSize: thumbnail.fileSize || 0
      };
    }
  }

  calculatePublishTime(strategy) {
    // Use strategy's recommended time or calculate optimal time
    if (strategy.bestPublishTime) {
      return strategy.bestPublishTime;
    }
    
    // Default: next optimal publishing window
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0); // 2 PM default
    
    return tomorrow.toISOString();
  }

  calculatePriority(strategy) {
    let priority = 50; // Base priority
    
    // Adjust based on estimated views
    if (strategy.estimatedViews > 100000) priority += 30;
    else if (strategy.estimatedViews > 50000) priority += 20;
    else if (strategy.estimatedViews > 10000) priority += 10;
    
    // Adjust based on trend score
    if (strategy.competitorAnalysis && strategy.competitorAnalysis.length > 0) {
      priority += 10;
    }
    
    // Time sensitivity
    const hoursUntilPublish = (new Date(strategy.bestPublishTime) - new Date()) / (1000 * 60 * 60);
    if (hoursUntilPublish < 24) priority += 20;
    else if (hoursUntilPublish < 48) priority += 10;
    
    return Math.min(100, priority);
  }

  async generateVideoContent(productionData) {
    this.logger.info('Generating AI video content...');
    
    try {
      const { script } = productionData;
      
      // Generate visual assets using DALL-E
      const visualPrompts = this.createVisualPromptsFromScript(script);
      const visualAssets = [];
      
      for (const prompt of visualPrompts) {
        const assets = await this.aiVideoGenerator.generateVisualAssets(prompt, 'ethereal', 1);
        visualAssets.push(...assets);
      }
      
      productionData.assets.video = {
        visualAssets: visualAssets,
        duration: productionData.estimatedDuration,
        format: 'mp4',
        resolution: '1920x1080',
        fps: 30,
        generatedWith: 'AI'
      };
      
      productionData.timeline.videoGenerated = new Date().toISOString();
      
      return visualAssets;
    } catch (error) {
      this.logger.error('AI video content generation failed:', error);
      // Fallback to placeholder
      return await this.createVideoElements(productionData);
    }
  }

  async createVideoElements(productionData) {
    const { script } = productionData;
    const elements = [];
    
    // Title slide
    elements.push({
      type: 'title_slide',
      content: script.title,
      duration: 3,
      style: 'modern',
      animation: 'fade_in'
    });
    
    // Content sections
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section) => {
        // Section title
        elements.push({
          type: 'section_title',
          content: section.title,
          duration: 2,
          style: 'minimal',
          animation: 'slide_in'
        });
        
        // Content visuals
        if (section.type === 'list_items' && section.items) {
          section.items.forEach(item => {
            elements.push({
              type: 'list_item',
              content: {
                number: item.number,
                title: item.title,
                description: item.description
              },
              duration: 15,
              style: 'countdown',
              animation: 'zoom_in'
            });
          });
        } else if (section.type === 'solution_steps' && section.steps) {
          section.steps.forEach(step => {
            elements.push({
              type: 'step',
              content: {
                number: step.number,
                title: step.title,
                description: step.description
              },
              duration: 20,
              style: 'tutorial',
              animation: 'step_by_step'
            });
          });
        } else {
          // Generic content slide
          elements.push({
            type: 'content_slide',
            content: section.title,
            duration: section.duration || 30,
            style: 'informative',
            animation: 'fade_transition'
          });
        }
      });
    }
    
    // Conclusion slide
    elements.push({
      type: 'conclusion',
      content: 'Key Takeaways',
      duration: 5,
      style: 'summary',
      animation: 'reveal'
    });
    
    // Subscribe reminder
    elements.push({
      type: 'subscribe_reminder',
      content: 'Subscribe for More!',
      duration: 3,
      style: 'call_to_action',
      animation: 'bounce'
    });
    
    return elements;
  }

  async generateAudioNarration(productionData) {
    this.logger.info('Generating AI audio narration...');
    
    try {
      const audioPath = path.join(__dirname, '..', 'data', 'audio', `${productionData.id}_narration.mp3`);
      
      // Read the TTS script
      const ttsText = await fs.readFile(productionData.assets.script.ttsPath, 'utf8');
      
      // Generate audio using AI TTS and retain the provider evidence returned by the generator.
      const generatedPath = await this.aiVideoGenerator.generateTTSAudio(ttsText, audioPath);
      const evidence = this.aiVideoGenerator.lastNarrationResult || {};
      const usable = await this.aiVideoGenerator.isUsableAudioFile(generatedPath);

      productionData.assets.audio = {
        path: generatedPath,
        duration: productionData.estimatedDuration,
        format: 'mp3',
        generatedWith: 'AI',
        quality: usable ? 'high' : null,
        status: usable ? 'ready' : 'unavailable',
        simulated: !usable,
        provider: evidence.provider || null,
        model: evidence.model || null,
        externalTaskId: evidence.externalTaskId || null,
        generatedAt: evidence.generatedAt || new Date().toISOString(),
        cost: evidence.cost || {},
        error: usable ? null : 'No live narration provider returned usable audio',
        intentionalSilence: false
      };

      if (usable) productionData.timeline.audioGenerated = new Date().toISOString();
      return generatedPath;
    } catch (error) {
      this.logger.error('AI audio generation failed:', error);
      return await this.simulateAudioGeneration(productionData, error);
    }
  }

  async generateCaptions(productionData) {
    this.logger.info('Generating captions...');
    
    const captionsPath = path.join(__dirname, '..', 'data', 'captions', `${productionData.id}_captions.srt`);
    
    // Generate SRT captions based on script timing
    const captions = await this.createSRTCaptions(productionData);
    
    await fs.mkdir(path.dirname(captionsPath), { recursive: true });
    await fs.writeFile(captionsPath, captions);
    
    productionData.assets.captions = {
      path: captionsPath,
      format: 'srt',
      language: 'en',
      autoGenerated: true
    };
    
    productionData.timeline.captionsGenerated = new Date().toISOString();
    
    return captionsPath;
  }

  async createSRTCaptions(productionData) {
    const { script } = productionData;
    let srt = '';
    let captionIndex = 1;
    let currentTime = 0;
    
    // Helper function to format time for SRT
    const formatSRTTime = (seconds) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };
    
    // Process script sections for captions
    const processText = (text, startTime, duration) => {
      const words = text.split(' ');
      const wordsPerCaption = 8; // Optimal words per caption
      
      for (let i = 0; i < words.length; i += wordsPerCaption) {
        const captionWords = words.slice(i, i + wordsPerCaption);
        const captionDuration = (duration / Math.ceil(words.length / wordsPerCaption));
        const captionStartTime = startTime + (i / words.length) * duration;
        const captionEndTime = captionStartTime + captionDuration;
        
        srt += `${captionIndex}\n`;
        srt += `${formatSRTTime(captionStartTime)} --> ${formatSRTTime(captionEndTime)}\n`;
        srt += `${captionWords.join(' ')}\n\n`;
        
        captionIndex++;
      }
    };
    
    // Hook
    if (script.hook && script.hook.text) {
      processText(script.hook.text, currentTime, 5);
      currentTime += 5;
    }
    
    // Introduction
    if (script.introduction) {
      const introText = `${script.introduction.greeting} ${script.introduction.topicIntro} ${script.introduction.valueProposition}`;
      processText(introText, currentTime, 15);
      currentTime += 15;
    }
    
    // Main content
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        let sectionText = '';
        
        if (Array.isArray(section.content)) {
          sectionText = section.content.filter(line => 
            typeof line === 'string' && !line.startsWith('[')
          ).join(' ');
        } else if (section.steps) {
          sectionText = section.steps.map(step => 
            `${step.title}. ${step.description}`
          ).join(' ');
        } else if (section.items) {
          sectionText = section.items.map(item => 
            `Number ${item.number}: ${item.title}. ${item.description}`
          ).join(' ');
        } else if (typeof section.content === 'string') {
          sectionText = section.content;
        }
        
        if (sectionText) {
          processText(sectionText, currentTime, section.duration || 60);
          currentTime += section.duration || 60;
        }
      });
    }
    
    // Conclusion
    if (script.conclusion) {
      const conclusionText = script.conclusion.recap.join(' ') + ' ' + script.conclusion.finalThought;
      processText(conclusionText, currentTime, 30);
      currentTime += 30;
    }
    
    return srt;
  }

  async assembleVideo(productionData) {
    this.logger.info('Assembling final AI-generated video...');
    
    try {
      const finalVideoPath = path.join(__dirname, '..', 'data', 'videos', `${productionData.id}_final.mp4`);
      const narrationReady = await this.aiVideoGenerator.isUsableAudioFile(productionData.assets.audio?.path);
      if (!narrationReady && productionData.assets.audio?.intentionalSilence !== true) {
        this.logger.warn('Final assembly is blocked until narration succeeds or the operator explicitly confirms an intentional silent video.');
        return await this.simulateVideoAssembly(productionData, 'Narration is missing');
      }

      // Use AI Video Generator to create the final video
      const producedPath = await this.aiVideoGenerator.generateVideo(
        productionData.script,
        productionData.assets.video.visualAssets || [],
        productionData.assets.audio.path,
        finalVideoPath,
        {
          jobId: productionData.jobId,
          productionId: productionData.id,
          estimatedDuration: productionData.estimatedDuration
        }
      );

      // The generator falls back to a placeholder .info file when it cannot render
      if (!producedPath || path.extname(producedPath).toLowerCase() !== '.mp4') {
        return await this.simulateVideoAssembly(productionData);
      }

      // Get file stats
      const stats = await fs.stat(finalVideoPath);
      
      productionData.assets.finalVideo = {
        path: finalVideoPath,
        fileSize: stats.size,
        duration: productionData.estimatedDuration,
        generatedWith: 'AI',
        resolution: '1920x1080',
        format: 'mp4',
        provider: this.aiVideoGenerator.lastVideoResult || { actualProvider: 'slideshow', model: 'local-ffmpeg' }
      };
      productionData.containsSyntheticMedia = Boolean(
        this.aiVideoGenerator.lastVideoResult?.actualProvider &&
        !['slideshow', 'simulation'].includes(this.aiVideoGenerator.lastVideoResult.actualProvider)
      );
      
      this.logger.info('AI video assembly complete');
      return finalVideoPath;
    } catch (error) {
      this.logger.error('AI video assembly failed:', error);
      // Fallback to simulation
      return await this.simulateVideoAssembly(productionData);
    }
  }

  async getPipelineStatus() {
    return this.pipeline.map(item => ({
      id: item.id,
      title: item.script?.title || 'Untitled',
      status: item.status,
      priority: item.priority,
      scheduledPublishTime: item.scheduledPublishTime,
      progress: this.calculateProgress(item)
    }));
  }

  calculateProgress(productionData) {
    const milestones = [
      'scriptReady',
      'thumbnailReady',
      'audioGenerated',
      'videoGenerated',
      'captionsGenerated',
      'readyForUpload'
    ];
    
    const completed = milestones.filter(milestone => 
      productionData.timeline[milestone] !== null
    ).length;
    
    return Math.round((completed / milestones.length) * 100);
  }

  async getNextReadyContent() {
    const ready = this.pipeline
      .filter(item => item.status === 'ready')
      .sort((a, b) => b.priority - a.priority);
    
    return ready[0] || null;
  }

  // Helper method to create visual prompts from script content
  createVisualPromptsFromScript(script) {
    const prompts = [];
    
    // Title prompt
    prompts.push(`${script.title}, ethereal storytelling, mystical background`);
    
    // Content-based prompts
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        if (section.title) {
          prompts.push(`${section.title}, ethereal dreamscape, creative visualization`);
        }
      });
    }
    
    // Ensure we have at least 3 prompts
    while (prompts.length < 3) {
      prompts.push('ethereal dreamscape, mystical storytelling, creative visualization');
    }
    
    return prompts.slice(0, 5); // Limit to 5 for cost control
  }

  // Fallback simulation methods
  async simulateAudioGeneration(productionData, failure = null) {
    const audioPath = path.join(__dirname, '..', 'data', 'audio', `${productionData.id}_narration.mp3`);
    
    await fs.writeFile(audioPath + '.info', JSON.stringify({
      message: 'AI TTS audio would be generated here',
      timestamp: new Date().toISOString()
    }, null, 2));
    
    productionData.assets.audio = {
      path: audioPath + '.info',
      duration: productionData.estimatedDuration,
      format: 'mp3',
      status: 'unavailable',
      simulated: true,
      provider: this.aiVideoGenerator.lastNarrationResult?.provider || 'simulation',
      model: this.aiVideoGenerator.lastNarrationResult?.model || null,
      externalTaskId: this.aiVideoGenerator.lastNarrationResult?.externalTaskId || null,
      generatedAt: this.aiVideoGenerator.lastNarrationResult?.generatedAt || new Date().toISOString(),
      cost: this.aiVideoGenerator.lastNarrationResult?.cost || { billed: false },
      error: failure?.message || this.aiVideoGenerator.lastNarrationResult?.error || 'No live narration provider is configured',
      intentionalSilence: false
    };
    
    return audioPath + '.info';
  }

  // =====================================================================
  // Professional production pipeline (content-type aware)
  // =====================================================================

  async processProfessionalPipeline(productionData) {
    const { ContentClassifier } = require('../utils/content-classifier');

    // ---- Stage 1: classification (content type drives every strategy) ----
    let classification = productionData.strategy?.classification || null;
    if (!classification) {
      try {
        const classifier = new ContentClassifier();
        classification = await classifier.classify({
          topic: productionData.script?.title || productionData.strategy?.topic || null,
          instructions: productionData.strategy?.angle || null
        });
      } catch (error) {
        this.logger.warn('Fallback classification failed:', error.message);
      }
    }
    if (classification) {
      productionData.contentType = classification.contentType;
      productionData.classification = classification;
      productionData.aspectRatio = classification.aspectRatio || '16:9';
      this.logger.info(`Content type: ${classification.contentType} (confidence ${classification.confidence}, via ${classification.classifier}, aspect ${productionData.aspectRatio})`);
    } else {
      productionData.contentType = 'long_form';
    }

    // ---- Stage 2: narration FIRST (its real duration drives the visuals) ----
    await this.generateAudioNarration(productionData);
    let timeline = null;
    try {
      timeline = await this.buildNarrationTimeline(productionData);
    } catch (error) {
      this.logger.warn('Narration timing failed; falling back to estimated timeline:', error.message);
    }

    // ---- Stage 3: visual plan (licensed stock first, AI fallback) ----
    let visualPlan = null;
    try {
      visualPlan = await this.buildVisualPlan(productionData, classification, timeline);
    } catch (error) {
      this.logger.warn('Visual planning failed; using legacy AI visuals:', error.message);
      await this.generateVideoContent(productionData);
    }

    // ---- Stage 4: scene-accurate captions + full-video SRT ----
    let captionSrts = null;
    try {
      captionSrts = await this.buildSceneCaptions(productionData, visualPlan, timeline);
    } catch (error) {
      this.logger.warn('Scene captions failed; using legacy captions:', error.message);
      await this.generateCaptions(productionData);
    }

    // ---- Stage 5: composition (professional compositor, legacy fallback) ----
    let composed = false;
    if (visualPlan && timeline) {
      try {
        composed = await this.composeProfessionalVideo(productionData, visualPlan, timeline, captionSrts);
      } catch (error) {
        this.logger.warn('Professional composition failed; using legacy assembly:', error.message);
      }
    }
    if (!composed) {
      await this.assembleVideo(productionData);
    }
  }

  /**
   * Measure the real narration audio and derive per-scene timing from the
   * actual waveform (silence-aware). Every downstream duration comes from the
   * narration instead of word-count estimates.
   */
  async buildNarrationTimeline(productionData) {
    const { probeMediaDuration, runFFmpeg } = require('../utils/ffmpeg');
    const { scriptScenes } = require('../utils/scene-repair-service');
    const audioPath = productionData.assets.audio?.path;
    if (!audioPath || productionData.assets.audio?.status !== 'ready') return null;

    const realDuration = await probeMediaDuration(audioPath);
    if (!realDuration || realDuration < 2) return null;
    productionData.assets.audio.duration = Number(realDuration.toFixed(2));
    productionData.assets.audio.durationMeasured = true;

    // Detect speech gaps so scene cuts land on natural pauses.
    let silences = [];
    try {
      const { stderr } = await runFFmpeg([
        '-i', String(audioPath),
        '-af', 'silencedetect=noise=-32dB:d=0.30',
        '-f', 'null', '-'
      ]);
      const out = String(stderr || '');
      const starts = [...out.matchAll(/silence_start:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
      const ends = [...out.matchAll(/silence_end:\s*([0-9.]+)/g)].map(m => parseFloat(m[1]));
      silences = starts.map((start, i) => ({ start, end: ends[i] !== undefined ? ends[i] : Math.min(start + 0.6, realDuration) }));
    } catch (error) {
      this.logger.warn('silencedetect failed; using proportional timing:', error.message);
    }

    const blueprints = scriptScenes(productionData.script || {});
    if (!blueprints.length) return null;

    // Word-share estimate per scene, then snap boundaries to nearby silences.
    const wordCounts = blueprints.map(b => Math.max(1, String(b.scriptText || '').split(/\s+/).filter(Boolean).length));
    const totalWords = wordCounts.reduce((a, b) => a + b, 0);
    const usable = Math.max(0.5, realDuration - 0.05);
    const boundaries = [];
    let cumulativeWords = 0;
    for (let i = 0; i < wordCounts.length - 1; i++) {
      cumulativeWords += wordCounts[i];
      const ideal = (cumulativeWords / totalWords) * usable;
      const window = Math.max(2.5, realDuration * 0.12);
      const candidates = silences
        .map(s => ({ midpoint: (s.start + s.end) / 2, gap: Math.abs((s.start + s.end) / 2 - ideal) }))
        .filter(c => c.gap <= window)
        .sort((a, b) => a.gap - b.gap);
      const previous = boundaries[boundaries.length - 1] || 0;
      const chosen = candidates.length ? candidates[0].midpoint : ideal;
      boundaries.push(Math.max(previous + 1.0, Math.min(usable - 1.0, Number(chosen.toFixed(2)))));
    }

    // Slice narration per scene (exact alignment for the compositor).
    const sceneAudioDir = path.join(__dirname, '..', 'data', 'audio', 'scenes', productionData.id);
    await fs.mkdir(sceneAudioDir, { recursive: true });
    const scenes = [];
    let sliceStart = 0;
    for (let i = 0; i < wordCounts.length; i++) {
      const end = i < boundaries.length ? boundaries[i] : realDuration;
      const duration = Math.max(1.0, end - sliceStart);
      const audioPath2 = path.join(sceneAudioDir, `${String(i).padStart(3, '0')}_base.mp3`);
      await runFFmpeg(['-y', '-i', String(audioPath), '-ss', sliceStart.toFixed(2), '-t', duration.toFixed(2), '-c:a', 'libmp3lame', '-q:a', '4', audioPath2]);
      scenes.push({
        position: i,
        label: blueprints[i].label,
        scriptText: blueprints[i].scriptText,
        start: Number(sliceStart.toFixed(2)),
        end: Number(end.toFixed(2)),
        duration: Number(duration.toFixed(2)),
        audioPath: audioPath2,
        realAudio: true,
        boundarySource: i < boundaries.length && silences.some(s => Math.abs((s.start + s.end) / 2 - boundaries[i]) < 0.05) ? 'silence_aligned' : 'proportional'
      });
      sliceStart = end;
    }

    const timeline = {
      totalDuration: Number(realDuration.toFixed(2)),
      scenes,
      silenceBoundaries: silences.length,
      measured: true
    };
    productionData.assets.audio.sceneTimeline = {
      measured: true,
      totalDuration: timeline.totalDuration,
      sceneCount: scenes.length,
      silenceAligned: scenes.filter(s => s.boundarySource === 'silence_aligned').length
    };
    this.logger.info(`Narration timeline: ${scenes.length} scenes over ${timeline.totalDuration}s (${timeline.silenceBoundaries} silences detected, ${timeline.scenes.filter(s => s.boundarySource === 'silence_aligned').length} aligned)`);
    return timeline;
  }

  /**
   * Plan visuals per scene: licensed stock/open assets first, AI image
   * generation only as fallback. Writes the license manifest.
   */
  async buildVisualPlan(productionData, classification, timeline) {
    const { VisualPlanner } = require('../utils/visual-planner');
    const { VisualSearchEngine } = require('../utils/visual-search');
    const { VisualQC } = require('../utils/visual-qc');
    const { Logger } = require('../utils/logger');

    const plannerContext = classification || { contentType: 'explainer', typeId: 'explainer', visualStrategy: {} };
    const orientation = productionData.aspectRatio === '9:16' ? 'portrait' : 'landscape';

    const search = new VisualSearchEngine();
    const planner = new VisualPlanner({
      visualSearch: search,
      aiTextService: this.getPlanningTextService(),
      logger: new Logger('VisualPlanner')
    });

    const plan = await planner.plan(productionData.script, plannerContext, {
      productionId: productionData.id,
      orientation
    });

    // AI fallback per scene that had no usable stock/open asset. Only a REAL,
    // decodable image counts — simulation placeholders (.info) do not.
    for (const scene of plan.scenes) {
      if (scene.status !== 'needs_generation') continue;
      try {
        const assets = await this.aiVideoGenerator.generateVisualAssets(scene.aiPrompt, 'cinematic', 1);
        const candidate = assets && assets.length ? assets[0] : null;
        if (candidate && await this.isRealImageFile(candidate)) {
          scene.assetPath = candidate;
          scene.status = 'ready';
          scene.assetOrigin = 'ai_fallback';
        } else {
          this.logger.warn(`AI visual fallback for scene ${scene.position} produced no real image — scene will use the compositor's gradient background`);
        }
      } catch (error) {
        this.logger.warn(`AI visual fallback failed for scene ${scene.position}: ${error.message}`);
      }
    }

    // Quality control pass (per-scene issues, never blocks — gradient scenes
    // remain a legitimate visual fallback inside the compositor).
    const qc = new VisualQC({ logger: new Logger('VisualQC') });
    const qcResult = await qc.validatePlan(plan, { scenes: timeline ? timeline.scenes : [] });
    productionData.assets.visualQc = qcResult.summary;
    if (!qcResult.ok) {
      this.logger.warn('Visual QC issues:\n' + qc.formatReport(qcResult));
    } else {
      this.logger.info(`Visual QC PASS: ${qcResult.summary.scenes} scenes (${qcResult.summary.stock} stock, ${qcResult.summary.ai} AI)`);
    }

    // License manifest on disk (per operator rules).
    const manifestDir = path.join(__dirname, '..', 'data', 'asset-manifests');
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, `${productionData.id}.json`);
    await fs.writeFile(manifestPath, JSON.stringify({
      productionId: productionData.id,
      generatedAt: new Date().toISOString(),
      classification: {
        contentType: plannerContext.contentType,
        aspectRatio: productionData.aspectRatio
      },
      stats: plan.stats,
      scenes: plan.scenes
    }, null, 2));

    productionData.assets.visualPlan = {
      manifestPath,
      stats: plan.stats,
      qc: qcResult.summary,
      scenes: plan.scenes.map(scene => ({
        position: scene.position,
        label: scene.label,
        visualQuery: scene.visualQuery,
        assetType: scene.assetType,
        assetPath: scene.assetPath,
        assetOrigin: scene.assetOrigin,
        provider: scene.provider || null,
        license: scene.license || null,
        licenseUrl: scene.licenseUrl || null,
        creator: scene.creator || null,
        pageUrl: scene.pageUrl || null,
        sourceUrl: scene.sourceUrl || null,
        motion: scene.motion,
        status: scene.status
      }))
    };

    productionData.assets.video = {
      visualAssets: plan.scenes.filter(s => s.assetPath).map(s => s.assetPath),
      duration: timeline ? timeline.totalDuration : productionData.estimatedDuration,
      format: 'mp4',
      resolution: productionData.aspectRatio === '9:16' ? '1080x1920' : '1920x1080',
      fps: 30,
      generatedWith: 'pro_visual_pipeline',
      licensedSources: plan.stats.stock
    };
    productionData.timeline.videoGenerated = new Date().toISOString();
    return plan;
  }

  /** Per-scene narration-synced captions + full-video SRT (one text layer). */
  async buildSceneCaptions(productionData, visualPlan, timeline) {
    const { CaptionEngine } = require('../utils/captions');
    const engine = new CaptionEngine();
    const granularity = productionData.classification?.editingStyle?.captions === 'word'
      ? 'word'
      : productionData.classification?.editingStyle?.captions === 'sentence' ? 'sentence' : 'phrase';
    const aspectRatio = productionData.aspectRatio || '16:9';

    const captionsDir = path.join(__dirname, '..', 'data', 'captions', productionData.id);
    await fs.mkdir(captionsDir, { recursive: true });

    const scenes = visualPlan ? visualPlan.scenes : [];
    const timing = timeline ? timeline.scenes : [];
    const sceneSrts = [];
    const fullEvents = [];
    const validationSummary = { scenes: 0, valid: 0, issues: [] };

    for (const [index, scene] of scenes.entries()) {
      const sceneTiming = timing[index];
      const duration = sceneTiming ? sceneTiming.duration : (scene.duration || 4);
      const text = sceneTiming ? sceneTiming.scriptText : scene.scriptText;
      const { events, srt, validation } = engine.buildSceneCaptions(text, duration, { granularity, aspectRatio });

      const srtPath = path.join(captionsDir, `scene_${String(index).padStart(3, '0')}.srt`);
      await fs.writeFile(srtPath, srt);
      sceneSrts.push({ position: index, srtPath, eventCount: events.length, valid: validation.ok });

      // Offset events to the full-video timeline for the upload SRT.
      const offset = sceneTiming ? sceneTiming.start : 0;
      for (const event of events) {
        fullEvents.push({ ...event, start: Number((event.start + offset).toFixed(3)), end: Number((event.end + offset).toFixed(3)) });
      }
      validationSummary.scenes += 1;
      if (validation.ok) validationSummary.valid += 1;
      else validationSummary.issues.push({ scene: index, issues: validation.issues });
    }

    const fullSrtPath = path.join(__dirname, '..', 'data', 'captions', `${productionData.id}_captions.srt`);
    await fs.mkdir(path.dirname(fullSrtPath), { recursive: true });
    await fs.writeFile(fullSrtPath, engine.toSRT(fullEvents));

    productionData.assets.captions = {
      path: fullSrtPath,
      format: 'srt',
      language: 'en',
      autoGenerated: true,
      narrationSynced: Boolean(timeline),
      granularity,
      sceneCaptions: sceneSrts,
      validation: validationSummary
    };
    productionData.timeline.captionsGenerated = new Date().toISOString();
    this.logger.info(`Captions: ${fullEvents.length} events across ${scenes.length} scenes (${validationSummary.valid}/${validationSummary.scenes} scenes valid)`);
    return sceneSrts;
  }

  /** Compose the final video with the professional compositor. */
  async composeProfessionalVideo(productionData, visualPlan, timeline, captionSrts) {
    const { ProfessionalCompositor } = require('../utils/compositor');
    const finalVideoPath = path.join(__dirname, '..', 'data', 'videos', `${productionData.id}_final.mp4`);

    const captionByPosition = new Map((captionSrts || []).map(entry => [entry.position, entry.srtPath]));
    const editingStyle = productionData.classification?.editingStyle || {};
    const compositionScenes = visualPlan.scenes.map((scene, index) => ({
      assetPath: scene.assetPath,
      assetType: scene.assetType === 'stock_video' ? 'stock_video' : 'stock_image',
      motion: scene.motion,
      label: scene.label,
      title: index === 0 ? productionData.script.title : null,
      narrationAudioPath: timeline.scenes[index] ? timeline.scenes[index].audioPath : null,
      duration: timeline.scenes[index] ? timeline.scenes[index].duration : (scene.duration || 4),
      captionSrtPath: captionByPosition.get(index) || null,
      editingStyle,
      overlayData: { itemNumber: scene.overlayNumber || null }
    }));

    const compositor = new ProfessionalCompositor({
      musicPath: process.env.MUSIC_PATH || null,
      musicVolume: process.env.MUSIC_VOLUME ? Number(process.env.MUSIC_VOLUME) : undefined
    });
    const result = await compositor.compose({
      scenes: compositionScenes,
      aspectRatio: productionData.aspectRatio || '16:9',
      transition: (productionData.classification?.pacingStyle?.transition === 'hard_cut') ? 'none' : 'crossfade',
      outputPath: finalVideoPath,
      totalDuration: timeline.totalDuration
    });

    const stats = await fs.stat(result.outputPath);
    productionData.assets.finalVideo = {
      path: result.outputPath,
      fileSize: stats.size,
      duration: timeline.totalDuration,
      generatedWith: 'pro_compositor',
      resolution: productionData.aspectRatio === '9:16' ? '1080x1920' : '1920x1080',
      format: 'mp4',
      provider: { actualProvider: 'pro_compositor', scenes: compositionScenes.length, transition: productionData.classification?.pacingStyle?.transition || 'crossfade' }
    };
    productionData.containsSyntheticMedia = true; // composed visuals + narration
    this.logger.info(`Professional composition complete: ${result.outputPath} (${Math.round(stats.size / 1024)} KiB, ${compositionScenes.length} scenes)`);
    return true;
  }

  /** True only when the path exists, has an image extension AND decodes via sharp. */
  async isRealImageFile(candidatePath) {
    try {
      if (!/\.(png|jpe?g|webp|gif|tiff?)$/i.test(String(candidatePath))) return false;
      const sharp = require('sharp');
      const metadata = await sharp(candidatePath).metadata();
      return Boolean(metadata.width && metadata.height);
    } catch (error) {
      return false;
    }
  }

  getPlanningTextService() {
    // Reuse the AI video generator's Gemini client for planner queries when available.
    if (this.aiVideoGenerator && this.aiVideoGenerator.gemini) {
      return {
        isAvailable: () => true,
        generateText: async (prompt, options = {}) => {
          const model = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
          const response = await this.aiVideoGenerator.gemini.models.generateContent({
            model,
            contents: prompt,
            config: { maxOutputTokens: options.maxTokens || 400, temperature: options.temperature ?? 0.4 }
          });
          return response.text || '';
        }
      };
    }
    return null;
  }

  async simulateVideoAssembly(productionData, reason = null) {
    const finalVideoPath = path.join(__dirname, '..', 'data', 'videos', `${productionData.id}_final.mp4`);
    
    const assemblyInstructions = {
      message: 'AI video would be assembled here',
      blockedReason: reason,
      assets: productionData.assets,
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(
      finalVideoPath + '.assembly.json',
      JSON.stringify(assemblyInstructions, null, 2)
    );
    
    productionData.assets.finalVideo = {
      path: finalVideoPath + '.assembly.json',
      fileSize: 0,
      duration: productionData.estimatedDuration,
      simulated: true,
      blockedReason: reason
    };
    
    return finalVideoPath + '.assembly.json';
  }
}

module.exports = { ProductionManagementAgent };
