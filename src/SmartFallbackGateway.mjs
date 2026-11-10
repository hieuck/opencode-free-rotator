#!/usr/bin/env node
/**
 * Smart Model Fallback Gateway
 * 
 * When a free model hits quota, automatically fallback to another free model
 * Transparent to user - they ask for deepseek, we serve with whatever works!
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// Free model fallback chain
// When first model exhausted, try next, then next, etc.
const FREE_MODEL_FALLBACK = [
  'opencode/deepseek-v4.1-flash-free',
  'opencode/beam-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/minimax-m3.1-flash-free',
  'opencode/glm-5.3-flash-free',
  'opencode/longcat-2.5-free',
  'opencode/iceman-free',
  'opencode/flint-40b-free',
  'opencode/inkling-2-small-free',
  'opencode/mimo-v2.6-flash-free'
];

// Track which models are exhausted (resets daily)
const exhaustedModels = new Set();
let lastReset = new Date().toDateString();

function checkDailyReset() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    console.log('📅 New day - resetting exhausted models tracker');
    exhaustedModels.clear();
    lastReset = today;
  }
}

/**
 * Get next available free model
 */
function getAvailableFreeModel(requestedModel) {
  checkDailyReset();
  
  // If requested model is not exhausted, use it
  if (!exhaustedModels.has(requestedModel)) {
    return requestedModel;
  }
  
  // Find first non-exhausted fallback model
  for (const model of FREE_MODEL_FALLBACK) {
    if (!exhaustedModels.has(model)) {
      console.log(`🔄 Fallback: ${requestedModel} → ${model}`);
      return model;
    }
  }
  
  // All models exhausted
  return null;
}

/**
 * Call OpenCode with model fallback
 */
async function callOpenCodeWithFallback(messages, requestedModel) {
  const prompt = messages[messages.length - 1].content;
  
  // Try requested model first, then fallbacks
  const modelsToTry = [
    requestedModel,
    ...FREE_MODEL_FALLBACK.filter(m => m !== requestedModel)
  ];
  
  for (const model of modelsToTry) {
    if (exhaustedModels.has(model)) {
      console.log(`⏭️  Skipping exhausted model: ${model}`);
      continue;
    }
    
    console.log(`🤖 Trying model: ${model}`);
    
    try {
      const result = await callOpenCode(model, prompt);
      
      // Success!
      console.log(`✅ Success with ${model}`);
      return {
        success: true,
        content: result.content,
        modelUsed: model,
        wasRequested: model === requestedModel
      };
      
    } catch (err) {
      if (err.type === 'quota_exceeded') {
        console.log(`❌ ${model} quota exceeded, marking as exhausted`);
        exhaustedModels.add(model);
        continue; // Try next model
      } else {
        throw err; // Other error, fail immediately
      }
    }
  }
  
  // All models exhausted
  return {
    success: false,
    error: 'All free models have reached their quota limit'
  };
}

/**
 * Call OpenCode CLI with specific model
 */
async function callOpenCode(model, prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('opencode', ['--non-interactive', '--model', model], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ content: stdout.trim() });
      } else {
        // Check if quota error
        if (stderr.includes('limit') || stderr.includes('quota')) {
          reject({ type: 'quota_exceeded', message: stderr });
        } else {
          reject({ type: 'error', message: stderr });
        }
      }
    });
    
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Main API endpoint - OpenAI compatible with smart fallback
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: messages array required',
        type: 'invalid_request_error'
      }
    });
  }
  
  console.log(`\n📨 Request for model: ${model}`);
  
  try {
    const result = await callOpenCodeWithFallback(messages, model);
    
    if (!result.success) {
      return res.status(429).json({
        error: {
          message: result.error,
          type: 'rate_limit_error',
          exhausted_models: Array.from(exhaustedModels)
        }
      });
    }
    
    // Success - return OpenAI-compatible response
    const response = {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.modelUsed,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: messages.reduce((sum, m) => sum + m.content.length / 4, 0),
        completion_tokens: result.content.length / 4,
        total_tokens: (messages.reduce((sum, m) => sum + m.content.length / 4, 0)) + (result.content.length / 4)
      },
      _meta: {
        requested_model: model,
        actual_model: result.modelUsed,
        fallback_used: !result.wasRequested
      }
    };
    
    if (!result.wasRequested) {
      console.log(`🔄 Fallback used: ${model} → ${result.modelUsed}`);
    }
    
    res.json(response);
    
  } catch (err) {
    console.error(`❌ Error:`, err);
    res.status(500).json({
      error: {
        message: err.message || 'Internal server error',
        type: 'api_error'
      }
    });
  }
});

/**
 * Health check with model status
 */
app.get('/health', (req, res) => {
  checkDailyReset();
  
  const modelStatus = FREE_MODEL_FALLBACK.map(model => ({
    model,
    status: exhaustedModels.has(model) ? 'exhausted' : 'available'
  }));
  
  const available = modelStatus.filter(m => m.status === 'available').length;
  const exhausted = modelStatus.filter(m => m.status === 'exhausted').length;
  
  res.json({
    status: available > 0 ? 'ok' : 'degraded',
    models: modelStatus,
    summary: {
      total: FREE_MODEL_FALLBACK.length,
      available,
      exhausted
    }
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 Smart Model Fallback Gateway - RUNNING                ║
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🏥 Health: http://localhost:${PORT}/health                    ║
║                                                            ║
║  💡 Smart Fallback Enabled!                               ║
║     Request deepseek → Automatically use available model  ║
║                                                            ║
║  📊 Free Models in Fallback Chain: ${FREE_MODEL_FALLBACK.length}                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready to serve with automatic model fallback! 🎉

Example:
  User requests: opencode/deepseek-v4.1-flash-free
  → If exhausted, auto-fallback to beam-free
  → User gets response, doesn't see error! ✅
  `);
});
