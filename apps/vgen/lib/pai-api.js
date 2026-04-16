const fs = require('fs');
const path = require('path');
const config = require('../config');

class PaiVideoAPI {
  constructor(apiKey = null) {
    this.apiKey = apiKey || config.pai.apiKey;
    this.baseUrl = config.pai.baseUrl;
    this.pollInterval = config.pai.pollInterval;
    this.maxPollAttempts = config.pai.maxPollAttempts;
  }

  generateTraceId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  buildMultipartBody(fieldName, fileBuffer, filename, contentType) {
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      body: Buffer.concat([header, fileBuffer, footer]),
      boundary
    };
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const traceId = options.traceId || this.generateTraceId();

    const headers = {
      'API-KEY': this.apiKey,
      'Ai-trace-id': traceId,
      ...options.headers
    };

    const fetchOptions = {
      method: options.method || 'GET',
      headers
    };

    if (options.body && options.method !== 'GET') {
      if (options.isFormData) {
        fetchOptions.body = options.body;
        delete headers['Content-Type'];
      } else {
        fetchOptions.body = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (data.ErrCode !== 0) {
      throw new Error(`PAI API Error: ${data.ErrMsg} (Code: ${data.ErrCode})`);
    }

    return data;
  }

  async uploadImage(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const { body, boundary } = this.buildMultipartBody('image', fileBuffer, filename, contentType);

    const response = await fetch(`${this.baseUrl}${config.models.imageUpload}`, {
      method: 'POST',
      headers: {
        'API-KEY': this.apiKey,
        'Ai-trace-id': this.generateTraceId(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      body
    });

    const data = await response.json();

    if (data.ErrCode !== 0) {
      throw new Error(`图片上传失败: ${data.ErrMsg}`);
    }

    return {
      imgId: data.Resp.img_id,
      imgUrl: data.Resp.img_url
    };
  }

  async uploadImageByBuffer(buffer, filename) {
    const contentType = filename.endsWith('.png') ? 'image/png' :
                        filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

    const { body, boundary } = this.buildMultipartBody('image', buffer, filename, contentType);

    const response = await fetch(`${this.baseUrl}${config.models.imageUpload}`, {
      method: 'POST',
      headers: {
        'API-KEY': this.apiKey,
        'Ai-trace-id': this.generateTraceId(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      body
    });

    const data = await response.json();

    if (data.ErrCode !== 0) {
      throw new Error(`图片上传失败: ${data.ErrMsg}`);
    }

    return {
      imgId: data.Resp.img_id,
      imgUrl: data.Resp.img_url
    };
  }

  async textToVideo(params) {
    const {
      prompt,
      aspectRatio = '16:9',
      duration = 5,
      model = config.pai.defaultModel,
      quality = '1080p',
      motionMode = config.pai.defaultMotionMode,
      negativePrompt = '',
      seed = 0,
      templateId = null,
      cameraMovement = null,
      lipSyncSwitch = false,
      lipSyncTtsContent = '',
      lipSyncTtsSpeakerId = '',
      soundEffectSwitch = false,
      soundEffectContent = '',
      generateAudioSwitch = true,
      generateMultiClipSwitch = false,
      thinkingType = 'auto'
    } = params;

    const body = {
      prompt,
      aspect_ratio: aspectRatio,
      duration,
      model,
      quality,
      motion_mode: motionMode,
      negative_prompt: negativePrompt,
      seed
    };

    if (templateId) body.template_id = templateId;
    if (cameraMovement) body.camera_movement = cameraMovement;

    if (lipSyncSwitch && lipSyncTtsContent) {
      body.lip_sync_switch = true;
      body.lip_sync_tts_content = lipSyncTtsContent;
      if (lipSyncTtsSpeakerId) body.lip_sync_tts_speaker_id = lipSyncTtsSpeakerId;
    }

    if (soundEffectSwitch) {
      body.sound_effect_switch = true;
      if (soundEffectContent) body.sound_effect_content = soundEffectContent;
    }

    if (['v5.5', 'v5.6', 'v6', 'c1'].includes(model)) {
      body.generate_audio_switch = generateAudioSwitch;
      if (['v5.6', 'v6'].includes(model)) {
        body.generate_multi_clip_switch = generateMultiClipSwitch;
      }
      body.thinking_type = thinkingType;
    }

    const data = await this.request(config.models.textToVideo, {
      method: 'POST',
      body
    });

    return {
      videoId: data.Resp.video_id,
      credits: data.Resp.credits
    };
  }

  async imgToVideo(params) {
    const {
      imgId,
      prompt,
      duration = 5,
      model = config.pai.defaultModel,
      quality = '1080p',
      motionMode = config.pai.defaultMotionMode,
      negativePrompt = '',
      seed = 0,
      templateId = null,
      cameraMovement = null,
      style = null,
      lipSyncSwitch = false,
      lipSyncTtsContent = '',
      lipSyncTtsSpeakerId = '',
      soundEffectSwitch = false,
      soundEffectContent = '',
      generateAudioSwitch = true,
      generateMultiClipSwitch = false,
      thinkingType = 'auto'
    } = params;

    if (!imgId) {
      throw new Error('imgId is required for image-to-video generation');
    }

    const body = {
      img_id: imgId,
      prompt,
      duration,
      model,
      quality,
      motion_mode: motionMode,
      negative_prompt: negativePrompt,
      seed
    };

    if (templateId) body.template_id = templateId;
    if (cameraMovement) body.camera_movement = cameraMovement;
    if (style) body.style = style;

    if (lipSyncSwitch && lipSyncTtsContent) {
      body.lip_sync_switch = true;
      body.lip_sync_tts_content = lipSyncTtsContent;
      if (lipSyncTtsSpeakerId) body.lip_sync_tts_speaker_id = lipSyncTtsSpeakerId;
    }

    if (soundEffectSwitch) {
      body.sound_effect_switch = true;
      if (soundEffectContent) body.sound_effect_content = soundEffectContent;
    }

    if (['v5.5', 'v5.6', 'v6', 'c1'].includes(model)) {
      body.generate_audio_switch = generateAudioSwitch;
      if (['v5.6', 'v6'].includes(model)) {
        body.generate_multi_clip_switch = generateMultiClipSwitch;
      }
      body.thinking_type = thinkingType;
    }

    const data = await this.request(config.models.imgToVideo, {
      method: 'POST',
      body
    });

    return {
      videoId: data.Resp.video_id,
      credits: data.Resp.credits
    };
  }

  async getVideoStatus(videoId) {
    const endpoint = `${config.models.videoResult}/${videoId}`;
    const data = await this.request(endpoint);

    const result = data.Resp;

    return {
      id: result.id,
      status: result.status,
      url: result.url,
      prompt: result.prompt,
      style: result.style,
      seed: result.seed,
      resolutionRatio: result.resolution_ratio,
      outputWidth: result.outputWidth,
      outputHeight: result.outputHeight,
      size: result.size,
      createTime: result.create_time,
      modifyTime: result.modify_time,
      negativePrompt: result.negative_prompt,
      isComplete: result.status === 1,
      isFailed: result.status === 8,
      isProcessing: result.status === 5,
      isReviewFailed: result.status === 7
    };
  }

  async waitForVideo(videoId, onProgress = null) {
    for (let i = 0; i < this.maxPollAttempts; i++) {
      const status = await this.getVideoStatus(videoId);

      if (onProgress) {
        onProgress({
          attempt: i + 1,
          status: status.status,
          isComplete: status.isComplete,
          isFailed: status.isFailed
        });
      }

      if (status.isComplete) {
        return { success: true, result: status };
      }

      if (status.isFailed) {
        return { success: false, error: '视频生成失败', result: status };
      }

      if (status.isReviewFailed) {
        return { success: false, error: '内容审核失败', result: status };
      }

      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    return { success: false, error: '等待超时' };
  }

  getStatusText(status) {
    const statusMap = {
      1: '已完成',
      5: '生成中',
      7: '审核失败',
      8: '生成失败'
    };
    return statusMap[status] || '未知状态';
  }
}

module.exports = PaiVideoAPI;
